import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  app = await createApp({ database: ":memory:", origin }),
  password = "Prueba-operativa-2026!",
  hash = await hashPassword(password);
const users = {};
for (const [role, name] of [
  ["administrador", "Administradora de prueba"],
  ["editor", "Responsable de cocina"],
  ["supervisor", "Supervisora de calidad"],
  ["lector", "Lector de prueba"],
])
  users[role] = Number(
    app.db
      .prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
      .run(name, role + "@example.test", hash, role).lastInsertRowid,
  );
const food = Number(
  app.db
    .prepare(
      "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
    )
    .run("Arroz de prueba", "Otros", 10, "2099-12-31", users.administrador)
    .lastInsertRowid,
);
app.server.listen(port, "127.0.0.1");
await once(app.server, "listening");
const evidence = "docs/operations/evidence";
await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "foodsave-operations-"));
const browser = await chromium.launch({ headless: true, slowMo: 100 }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: evidence, size: { width: 1440, height: 1000 } },
  }),
  page = await context.newPage();
const errors = [],
  checks = [],
  overflows = [];
page.on("pageerror", (e) => errors.push(e.message));
const snap = async (name) => {
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(evidence, name), fullPage: true });
};
const login = async (role) => {
  await page.getByLabel("Correo electrónico").fill(role + "@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
};
const logout = async () => {
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page
    .getByRole("heading", { name: "Iniciar sesión", exact: true })
    .waitFor();
};
const go = async () => {
  await page.getByRole("button", { name: "Operaciones", exact: true }).click();
  await page
    .getByRole("heading", { name: "Operaciones", exact: true })
    .waitFor();
  await page.locator("#operation-filters").waitFor();
};
const selectOp = async (id) => {
  await page.locator(`[data-operation="${id}"]`).click();
  await page.locator("#operation-detail .panel-head h2").waitFor();
};
const state = async (label) => {
  await page
    .locator("#operation-detail .panel-head .badge")
    .getByText(label, { exact: true })
    .waitFor();
};
const create = async (title, type = "consumo", quantity = 3) => {
  const form = page.locator("#create-operation");
  await form.getByLabel("Título de la operación").fill(title);
  await form.getByLabel("Tipo de operación").selectOption(type);
  await form.getByLabel("Alimento de la operación").selectOption(String(food));
  await form.getByLabel("Cantidad de la operación").fill(String(quantity));
  await form
    .getByLabel("Responsable de la operación")
    .selectOption(String(users.editor));
  await form.getByLabel("Fecha prevista de la operación").fill("2099-12-01");
  await form
    .getByLabel("Notas de la operación")
    .fill("Planificación de cocina.");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/operations") && r.request().method() === "POST",
    ),
    form.getByRole("button", { name: "Crear operación", exact: true }).click(),
  ]);
  return { response, body: await response.json() };
};
try {
  await page.goto(origin);
  await login("administrador");
  await go();
  await snap("01-operations-empty.png");
  const invalid = await create("Intento sin existencias", "consumo", 999);
  assert.equal(invalid.response.status(), 409);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM operations").get().n, 0);
  checks.push("Regla de existencias rechaza cantidad excesiva");
  const created = await create("Consumo del almuerzo");
  assert.equal(created.response.status(), 201);
  const id = created.body.operation.id;
  await state("Pendiente");
  await snap("02-operation-created.png");
  checks.push("Creación de operación pendiente");
  await page.locator(".operation-editor>summary").click();
  await page
    .getByLabel("Editar título")
    .fill("Consumo del almuerzo actualizado");
  await page.getByLabel("Editar cantidad").fill("4");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/operations/" + id) &&
        r.request().method() === "GET",
    ),
    page.getByRole("button", { name: "Guardar cambios de operación" }).click(),
  ]);
  await page
    .locator("#operation-detail h2")
    .getByText("Consumo del almuerzo actualizado", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Iniciar operación", exact: true })
    .click();
  await state("En proceso");
  await snap("03-operation-in-progress.png");
  checks.push("Actualización con historial e inicio de operación");
  await logout();
  await login("editor");
  await go();
  await selectOp(id);
  assert.equal(
    await page
      .getByRole("button", { name: "Cerrar operación", exact: true })
      .count(),
    0,
  );
  const editorDenied = await page.evaluate(async (id) => {
    const me = await (await fetch("/api/me")).json();
    const o = await (await fetch("/api/operations/" + id)).json();
    const r = await fetch("/api/operations/" + id + "/close", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf },
      body: JSON.stringify({
        expected_version: o.operation.version,
        note: "Intento de cierre no autorizado",
      }),
    });
    return r.status;
  }, id);
  assert.equal(editorDenied, 403);
  checks.push("Editor sin botón de cierre y API rechaza con 403");
  await logout();
  await login("supervisor");
  await go();
  await selectOp(id);
  assert.equal(await page.locator("#create-operation").count(), 0);
  await page
    .getByLabel("Observación de cierre o cancelación")
    .fill("Consumo verificado por supervisión.");
  await page
    .getByRole("button", { name: "Cerrar operación", exact: true })
    .click();
  await state("Cerrada");
  assert.equal(
    app.db.prepare("SELECT quantity FROM foods WHERE id=?").get(food).quantity,
    6,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Cerrar operación", exact: true })
      .count(),
    0,
  );
  await page
    .locator(".operation-history details")
    .last()
    .locator("summary")
    .click();
  await snap("04-closed-history.png");
  checks.push(
    "Supervisor cierra, descuenta 4 unidades y conserva historial inmutable",
  );
  await page.getByLabel("Estado", { exact: true }).selectOption("cerrada");
  await page.getByLabel("Fecha prevista desde").fill("2099-12-01");
  await page.getByLabel("Fecha prevista hasta").fill("2099-12-01");
  await page
    .getByLabel("Responsable", { exact: true })
    .selectOption(String(users.editor));
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/operations?") && r.request().method() === "GET",
    ),
    page.getByRole("button", { name: "Filtrar operaciones" }).click(),
  ]);
  assert.equal(await page.locator("[data-operation]").count(), 1);
  await snap("05-filtered-operations.png");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar operaciones CSV" }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^foodsave-operaciones-/);
  await download.saveAs(join(temp, "operations.csv"));
  const csv = await readFile(join(temp, "operations.csv"), "utf8");
  assert.ok(
    csv.includes('"Total","1"') &&
      csv.includes("Consumo del almuerzo actualizado") &&
      csv.includes("Cerrada"),
  );
  checks.push(
    "Filtros por estado, fecha prevista y responsable; CSV descargado coincide",
  );
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Imprimir reporte de operaciones" }).click(),
  ]);
  await print
    .getByRole("heading", { name: "Reporte de operaciones", exact: true })
    .waitFor();
  await print.emulateMedia({ media: "print" });
  await print.screenshot({
    path: join(evidence, "06-operations-report.png"),
    fullPage: true,
  });
  await print.close();
  checks.push("Reporte imprimible preparado para guardar PDF");
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await page.getByLabel("Estado", { exact: true }).selectOption("pendiente");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/operations?")),
    page.getByRole("button", { name: "Filtrar operaciones" }).click(),
  ]);
  await page
    .getByText("No hay operaciones para los filtros seleccionados.", {
      exact: true,
    })
    .waitFor();
  checks.push("Consulta sin coincidencias presenta estado vacío");
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await logout();
  await login("administrador");
  await go();
  const cancelled = await create(
    "Descarte por control de calidad",
    "descarte",
    1,
  );
  assert.equal(cancelled.response.status(), 201);
  await state("Pendiente");
  await page
    .getByLabel("Observación de cierre o cancelación")
    .fill("Se cancela para revisar la planificación.");
  await page
    .getByRole("button", { name: "Cancelar operación", exact: true })
    .click();
  await state("Cancelada");
  assert.equal(
    app.db.prepare("SELECT quantity FROM foods WHERE id=?").get(food).quantity,
    6,
  );
  await snap("07-cancelled-operation.png");
  checks.push("Cancelación justificada sin descuento de inventario");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      overflows.push(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await snap("08-operations-mobile.png");
  await logout();
  await login("lector");
  assert.equal(
    await page
      .getByRole("button", { name: "Operaciones", exact: true })
      .count(),
    0,
  );
  const readerDenied = await page.evaluate(async () => ({
    list: (await fetch("/api/operations")).status,
    report: (await fetch("/api/operations/export.csv")).status,
  }));
  assert.deepEqual(readerDenied, { list: 403, report: 403 });
  checks.push("Lector sin módulo y API de consulta/reporte restringida");
  assert.deepEqual(errors, []);
  assert.deepEqual(overflows, []);
  const video = page.video();
  await context.close();
  await video.saveAs(join(evidence, "demo-operaciones.webm"));
  await video.delete();
  await writeFile(
    join(evidence, "browser-results.json"),
    JSON.stringify(
      {
        result: "passed",
        checks,
        errors,
        overflows,
        viewports: [390, 768, 1440],
        editorDenied,
        readerDenied,
      },
      null,
      2,
    ),
  );
  console.log(
    "Gestión operativa: demostración y evidencia de navegador aprobadas.",
  );
} finally {
  await browser.close();
  await new Promise((r) => app.server.close(r));
  app.db.close();
  await rm(temp, { recursive: true, force: true });
}
