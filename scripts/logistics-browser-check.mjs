import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";

const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const { server, db } = await createApp({ database: ":memory:", origin });
const password = "Prueba-browser-logistica-2026!";
const hash = await hashPassword(password);
for (const [role, name] of [["administrador", "Administradora de logística"], ["supervisor", "Supervisor de logística"], ["lector", "Lector de prueba"]]) {
  db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)").run(name, role + "@example.test", hash, role);
}
server.listen(port, "127.0.0.1");
await once(server, "listening");
const evidence = process.env.FOODSAVE_EVIDENCE_DIR ?? "docs/logistics/evidence";
let browser;
try {
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: "es-DO", acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const snap = async (name, locator) => {
    const path = join(evidence, name + ".png");
    if (locator) await page.locator(locator).screenshot({ path });
    else await page.screenshot({ path });
  };
  const login = async (role) => {
    await page.getByLabel("Correo electrónico").fill(role + "@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
  };
  const logout = async () => {
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  };
  const openLogistics = async () => {
    await page.getByRole("button", { name: "Logística", exact: true }).click();
    await page.getByRole("heading", { name: "Existencias por lote" }).waitFor();
  };

  await page.goto(origin);
  await login("administrador");
  await openLogistics();
  await page.getByLabel("Nombre del alimento").fill("Arroz integral · Demo");
  await page.getByLabel("Categoría").selectOption("Otros");
  await page.getByLabel("Fecha de vencimiento").fill("2099-11-12");
  await page.getByLabel("Cantidad inicial").fill("10");
  await page.getByRole("button", { name: "Guardar lote" }).click();
  const row = page.locator("#logistics-stock tr").filter({ hasText: "Arroz integral · Demo" });
  await row.waitFor();
  await snap("01-existencias-iniciales");
  const type = page.getByLabel("Tipo de movimiento");
  const amount = page.getByLabel("Unidades del movimiento");
  const reason = page.getByLabel("Motivo o destino");
  const save = page.getByRole("button", { name: "Guardar movimiento" });
  await page.getByLabel("Lote del movimiento").selectOption("1");
  await type.selectOption("entry");
  await amount.fill("5");
  await reason.fill("Reposición de despensa");
  await save.click();
  await row.getByText("15", { exact: true }).first().waitFor();
  await type.selectOption("exit");
  await amount.fill("20");
  await reason.fill("Entrega al comedor");
  await save.click();
  await page.getByText("Existencias insuficientes para esta salida").waitFor();
  await snap("02-disponibilidad-validada", "#logistics-move-form");
  await amount.fill("4");
  await save.click();
  await row.getByText("11", { exact: true }).first().waitFor();
  await page.locator("#logistics-history").getByText("15 → 11").waitFor();
  await page.locator("#logistics-history").getByText("10 → 15").waitFor();
  await snap("03-historial-completo", 'section[aria-labelledby="movement-title"]');
  await page.getByLabel("Filtrar por tipo").selectOption("exit");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#logistics-history tr").length === 1);
  const download = async (name) => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name }).click()]);
    return readFile(await file.path(), "utf8");
  };
  const movements = await download("Descargar movimientos CSV");
  assert.match(movements, /Entrega al comedor/);
  assert.doesNotMatch(movements, /Reposición de despensa/);
  const stock = await download("Descargar existencias CSV");
  assert.match(stock, /"11","11"/);
  await snap("04-historial-filtrado", 'section[aria-labelledby="movement-title"]');

  await logout();
  await login("supervisor");
  await openLogistics();
  assert.equal(await page.getByRole("link", { name: "Descargar existencias CSV" }).count(), 1);
  assert.equal(await save.count(), 0);
  assert.equal(await page.getByRole("button", { name: "Guardar lote" }).count(), 0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page overflow at " + width);
  }
  await snap("05-supervisor-consulta");
  await logout();
  await login("lector");
  assert.equal(await page.getByRole("button", { name: "Logística", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Logística: alta, reposición, salida rechazada, entrega, historial, filtros, dos CSV y roles verificados en Chromium; sin desborde a 390, 768 y 1440 px.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
}
