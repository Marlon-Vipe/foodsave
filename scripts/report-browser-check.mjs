import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdir, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = await createApp({ database: ":memory:", origin });
const password = "Reporte-seguro-2026!";
const id = Number(
  app.db
    .prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
    .run(
      "Supervisor de prueba",
      "supervisor@example.test",
      await hashPassword(password),
      "supervisor",
    ).lastInsertRowid,
);
for (const [name, status, quantity] of [
  ["Leche entera", "available", 2],
  ["Pan integral", "consumed", 1],
  ["Tomates", "wasted", 3],
])
  app.db
    .prepare(
      "INSERT INTO foods(name,category,quantity,expires,status,created_by) VALUES (?,?,?,?,?,?)",
    )
    .run(name, "Otros", quantity, "2026-12-01", status, id);
app.server.listen(port, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const temp = await mkdtemp(join(tmpdir(), "foodsave-report-"));
try {
  await page.goto(origin);
  await page.getByLabel("Correo electrónico").fill("supervisor@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Reportes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Estadísticas", exact: true })
    .waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar reporte CSV" }).click(),
  ]);
  assert.match(
    download.suggestedFilename(),
    /^foodsave-reporte-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const file = join(temp, "report.csv");
  await download.saveAs(file);
  const csv = await readFile(file, "utf8");
  assert.ok(csv.includes('"Total de alimentos","3"'));
  assert.ok(
    csv.includes("Leche entera") &&
      csv.includes("Pan integral") &&
      csv.includes("Tomates"),
  );
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Generar reporte / guardar PDF" }).click(),
  ]);
  print.on("pageerror", (e) => errors.push(e.message));
  await print.getByRole("heading", { name: "Reporte de alimentos" }).waitFor();
  assert.equal(await print.locator("tbody tr").count(), 3);
  await print.evaluate(() => {
    window.print = () => {
      window.printInvoked = true;
    };
  });
  await print
    .getByRole("button", { name: "Imprimir / guardar como PDF" })
    .click();
  assert.equal(await print.evaluate(() => window.printInvoked), true);
  await print.emulateMedia({ media: "print" });
  assert.equal(await print.locator(".toolbar").isVisible(), false);
  await mkdir("docs/evidence", { recursive: true });
  await print.screenshot({
    path: "docs/evidence/09-report-print.png",
    fullPage: true,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(
    "Reporte: descarga CSV, detalle completo, vista imprimible y botón de impresión verificados.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
  await rm(temp, { recursive: true, force: true });
}
