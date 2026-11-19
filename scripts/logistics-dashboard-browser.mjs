import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";

const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = await createApp({ database: ":memory:", origin });
const password = "Panel-logistico-prueba-2026!";
const hash = await hashPassword(password);
const userIds = {};
for (const role of ["administrador", "editor", "supervisor", "lector"])
  userIds[role] = Number(app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
    .run("Demo " + role, role + "@example.test", hash, role).lastInsertRowid);
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
const offset = (days) => new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
const insert = app.db.prepare("INSERT INTO foods(name,category,quantity,expires,status,created_by) VALUES (?,?,?,?,?,?)");
insert.run("Arroz integral", "Otros", 10, offset(6), "available", userIds.administrador);
insert.run("Arroz integral", "Otros", 5, offset(1), "available", userIds.administrador);
insert.run("Yogur natural", "Lácteos", 3, offset(-1), "available", userIds.administrador);
insert.run("Pan integral", "Panadería", 0, offset(-2), "distributed", userIds.administrador);
app.server.listen(port, "127.0.0.1");
await once(app.server, "listening");

const evidence = process.env.FOODSAVE_EVIDENCE_DIR ?? "docs/logistics/evidence";
await mkdir(evidence, { recursive: true });
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "es-DO" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = async (role) => {
    await page.getByLabel("Correo electrónico").fill(role + "@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
  };
  const go = async () => {
    await page.getByRole("button", { name: "Logística", exact: true }).click();
    await page.locator("#dashboard-summary strong").first().waitFor();
  };
  const screenshot = (name) => page.screenshot({ path: evidence + "/" + name + ".png" });
  const filter = page.getByLabel("Filtrar alertas");
  await page.goto(origin);
  await login("administrador");
  await go();
  await screenshot("06-panel-logistico");
  const priority = page.locator("#dashboard-priority article");
  assert.match(await priority.first().innerText(), /lote #2/);
  await priority.first().getByRole("button", { name: "Registrar salida" }).click();
  assert.equal(await page.locator("#logistics-food").getAttribute("id"), "logistics-food");
  assert.equal(await page.locator("#logistics-food").evaluate((el) => el.value), "2");
  assert.equal(await page.locator("#logistics-type").evaluate((el) => el.value), "exit");
  await page.getByLabel("Unidades del movimiento").fill("2");
  await page.getByLabel("Motivo o destino").fill("Entrega del lote que vence primero");
  await page.getByRole("button", { name: "Guardar movimiento" }).click();
  await page.waitForFunction(() => document.querySelector("#dashboard-summary strong")?.textContent === "13");

  await page.locator(".logistics-minimums summary").click();
  await page.getByLabel("Mínimo de Arroz integral · Otros", { exact: true }).fill("20");
  await page.locator("#dashboard-minimums tr").filter({ hasText: "Arroz integral" })
    .getByRole("button", { name: "Guardar mínimo" }).click();
  await filter.selectOption("low");
  const riceAlert = page.locator("#dashboard-alerts article").filter({ hasText: "Arroz integral" });
  await riceAlert.getByText("13 disponibles · mínimo 20 · faltan 7").waitFor();
  await screenshot("07-minimos-y-alertas");
  await riceAlert.getByRole("button", { name: "Registrar entrada" }).click();
  assert.equal(await page.locator("#logistics-food").evaluate((el) => el.value), "1");
  assert.equal(await page.locator("#logistics-type").evaluate((el) => el.value), "entry");
  await page.getByLabel("Unidades del movimiento").fill("7");
  await page.getByLabel("Motivo o destino").fill("Reposición hasta mínimo de veinte");
  await page.getByRole("button", { name: "Guardar movimiento" }).click();
  await page.waitForFunction(() => document.querySelector("#dashboard-summary strong")?.textContent === "20");
  await page.getByText("No hay alertas para este filtro.", { exact: true }).waitFor();

  await filter.selectOption("expired");
  const expired = page.locator("#dashboard-alerts article").filter({ hasText: "Yogur natural" });
  await expired.getByRole("button", { name: "Preparar descarte" }).click();
  await page.locator("#create-operation").waitFor();
  assert.equal(await page.locator("#new-food").evaluate((el) => el.value), "3");
  assert.equal(await page.locator("#new-type").evaluate((el) => el.value), "descarte");
  assert.equal(await page.locator("#new-quantity").evaluate((el) => el.value), "3");
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM operations").get().n, 0);
  await page.getByLabel("Responsable de la operación", { exact: true }).selectOption(String(userIds.editor));
  await screenshot("08-descarte-preparado");
  await page.getByRole("button", { name: "Crear operación", exact: true }).click();
  await page.getByText("Operación creada.", { exact: true }).waitFor();
  assert.equal(app.db.prepare("SELECT type FROM operations").get().type, "descarte");
  assert.equal(app.db.prepare("SELECT quantity FROM foods WHERE id=3").get().quantity, 3);

  await go();
  await page.locator(".logistics-minimums summary").click();
  await page.getByLabel("Mínimo de Pan integral · Panadería", { exact: true }).fill("5");
  await page.locator("#dashboard-minimums tr").filter({ hasText: "Pan integral" })
    .getByRole("button", { name: "Guardar mínimo" }).click();
  await filter.selectOption("low");
  await page.locator("#dashboard-alerts article").filter({ hasText: "Pan integral" })
    .getByRole("button", { name: "Registrar lote de reposición" }).click();
  assert.equal(await page.locator("#logistics-name").evaluate((el) => el.value), "Pan integral");
  assert.equal(await page.locator("#logistics-category").evaluate((el) => el.value), "Panadería");
  assert.equal(await page.locator("#logistics-expiry").evaluate((el) => el.value), "");

  app.db.prepare("UPDATE foods SET quantity=quantity+1 WHERE id=1").run();
  await page.getByRole("button", { name: "Actualizar panel" }).click();
  await page.waitForFunction(() => document.querySelector("#dashboard-summary strong")?.textContent === "21");
  await page.locator("#dashboard-priority article").filter({ hasText: "lote #1" })
    .getByRole("button", { name: "Registrar salida" }).click();
  await page.getByText("Disponible: 18 unidades. Capacidad para recibir: 9982.", { exact: true }).waitFor();

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Overflow at " + width);
  }
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await login("supervisor");
  await go();
  assert.equal(await page.locator("[data-dashboard-action]").count(), 0);
  assert.equal(await page.locator("[data-minimum-form]").count(), 0);
  await screenshot("09-supervisor-panel");
  assert.deepEqual(errors, []);
  console.log("Panel logístico aprobado: FEFO, salida, mínimos, entrada, alertas resueltas, descarte prellenado, reposición de agotado, supervisor y 390/768/1440 px.");
} finally {
  await browser?.close();
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
}
