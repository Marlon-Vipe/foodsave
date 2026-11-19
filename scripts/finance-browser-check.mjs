import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
import { todayDO } from "../finance-store.mjs";

const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`, date = todayDO();
const after = (days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const app = await createApp({
  database: ":memory:", origin,
  ai: async (input) => input.name === "foodsave_saving_advice"
    ? { summary: "Tienes arroz próximo a vencer.", actions: ["Prioriza el lote de arroz en tus próximas comidas."] }
    : { raw_text: "FACTURA DE PRUEBA. Arroz integral 2 x 50. Leche entera 3 x 80.",
      currency: "DOP", purchased_on: date, warnings: ["Completa los vencimientos antes de guardar."],
      products: [
        { name: "Arroz integral", category: "Otros", quantity: 2, unit_cost_cents: 5000, expires: null, note: "" },
        { name: "Leche entera", category: "Lácteos", quantity: 3, unit_cost_cents: 8000, expires: null, note: "" },
      ] },
});
const password = "Finanzas-browser-2026!";
const hash = await hashPassword(password);
for (const role of ["administrador", "supervisor", "lector"])
  app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
    .run("Demo " + role, role + "@example.test", hash, role);
app.server.listen(port, "127.0.0.1");
await once(app.server, "listening");
const evidence = process.env.FOODSAVE_EVIDENCE_DIR ?? "docs/finance/evidence";
await mkdir(evidence, { recursive: true });
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: "es-DO" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const login = async (role) => {
    await page.getByLabel("Correo electrónico").fill(role + "@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await button("Entrar").click();
    await button("Cerrar sesión").waitFor();
  };
  const go = async (name) => {
    if (await page.locator("#menu-toggle").isVisible()) await page.locator("#menu-toggle").click();
    await button(name).click();
    await page.locator("main h1").waitFor();
  };
  await page.goto(origin);
  await login("administrador");
  await go("Inventario");
  await page.getByLabel("Nombre del alimento", { exact: true }).fill("Arroz de clase");
  await page.getByLabel("Categoría", { exact: true }).selectOption("Otros");
  await page.getByLabel("Fecha de vencimiento", { exact: true }).fill(after(2));
  await page.getByLabel("Cantidad", { exact: true }).fill("10");
  await page.getByLabel("Costo unitario (RD$)", { exact: true }).fill("50");
  await button("Guardar alimento").click();
  await page.getByText("Alimento guardado.", { exact: true }).waitFor();
  assert.equal(app.db.prepare("SELECT SUM(total_cents) total FROM financial_movements").get().total, 50000);
  await go("Finanzas");
  await page.locator("#budget-amount").fill("2000");
  await button("Guardar presupuesto").click();
  await page.waitForFunction(() => document.querySelector("#budget-amount")?.value === "2000.00");
  await page.locator("#economic-kind").selectOption("aid");
  await page.locator("#economic-description").fill("Donación recibida para alimentos");
  await page.locator("#economic-amount").fill("200");
  await button("Guardar registro económico").click();
  await page.getByText("Donación recibida para alimentos", { exact: true }).waitFor();
  await page.locator("#economic-description").fill("Transporte de compra");
  await page.locator("#economic-amount").fill("50");
  await button("Guardar registro económico").click();
  await page.getByText("Transporte de compra", { exact: true }).waitFor();
  await button("Pedir sugerencias de ahorro a IA").click();
  await page.getByText("Prioriza el lote de arroz en tus próximas comidas.", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: evidence + "/01-finanzas-presupuesto.png" });

  await go("Escanear productos");
  await page.getByLabel("Foto de factura o productos", { exact: true }).setInputFiles("docs/finance/evidence/receipt-demo.png");
  await button("Analizar imagen").click();
  await page.getByRole("heading", { name: "Revisar productos detectados" }).waitFor();
  assert.equal(app.db.prepare("SELECT COUNT(*) total FROM foods").get().total, 1);
  assert.equal(await page.locator("#scan-expiry-0").evaluate((el) => el.validity.valid), false);
  await page.locator("#scan-expiry-0").fill(after(3));
  await page.locator("#scan-expiry-1").fill(after(4));
  await page.screenshot({ path: evidence + "/02-ocr-revision.png" });
  await button("Registrar productos revisados").click();
  await page.getByRole("heading", { name: "Productos registrados", exact: true }).waitFor();
  assert.equal(app.db.prepare("SELECT COUNT(*) total FROM foods").get().total, 3);
  assert.equal(app.db.prepare("SELECT SUM(total_cents) total FROM financial_movements").get().total, 84000);

  await go("Finanzas");
  await page.locator("#budget-amount").waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar finanzas CSV" }).click(),
  ]);
  const csv = await readFile(await download.path(), "utf8");
  assert.match(csv, /890\.00/);
  await page.screenshot({ path: evidence + "/03-gastos-e-importacion.png" });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Overflow at " + width);
    if (width === 390) await page.screenshot({ path: evidence + "/04-finanzas-movil.png" });
  }
  await button("Cerrar sesión").click();
  await login("supervisor");
  await go("Finanzas");
  await page.getByRole("link", { name: "Descargar finanzas CSV" }).waitFor();
  assert.equal(await page.locator("#finance-record").count(), 0);
  assert.equal(await button("Escanear productos").count(), 0);
  await button("Cerrar sesión").click();
  await login("lector");
  await page.getByRole("heading", { name: "Hola, Demo.", exact: true }).waitFor();
  assert.equal(await button("Finanzas").count(), 0);
  assert.equal(await button("Escanear productos").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Finanzas en Chromium aprobadas: costo, presupuesto, donación, gasto, sugerencias con fixture, revisión OCR, registro, CSV, responsive y permisos. IA real se verifica por separado.");
} finally {
  await browser?.close();
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
}
