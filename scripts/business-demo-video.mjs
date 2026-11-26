// Grabación reproducible del flujo real. Datos sintéticos; no toca app.sqlite.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
import { businessToday } from "../business-utils.mjs";

const pace = Number(process.env.FOODSAVE_VIDEO_PACE ?? 1);
assert(Number.isFinite(pace) && pace > 0 && pace <= 2);
const directory = resolve(process.env.FOODSAVE_VIDEO_DIR ?? "../business-video");
await mkdir(directory + "/capture", { recursive: true });
await mkdir(directory + "/qa", { recursive: true });
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`, date = businessToday();
const day = (n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const app = await createApp({ database: ":memory:", origin });
const password = randomBytes(18).toString("hex"), hash = await hashPassword(password), users = {};
for (const [role, name] of [["administrador", "Ana Martínez"], ["editor", "Carlos Méndez"], ["supervisor", "Laura Gómez"], ["lector", "Sofía Reyes"]])
  users[role] = Number(app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
    .run(name, role + "@demo.foodsave.test", hash, role).lastInsertRowid);
app.server.listen(port, "127.0.0.1");
await once(app.server, "listening");
let browser;
const chapters = [], errors = [];
try {
  browser = await chromium.launch({ args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", acceptDownloads: true,
    recordVideo: { dir: directory + "/capture", size: { width: 1440, height: 1000 } } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const start = performance.now();
  const pause = (ms) => page.waitForTimeout(ms * pace);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const show = async (locator) => { await locator.evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" })); await pause(650); };
  const callout = async (title, note, number) => page.evaluate(({ title, note, number }) => {
    let box = document.querySelector("#video-callout");
    if (!box) {
      box = document.createElement("aside"); box.id = "video-callout";
      Object.assign(box.style, { position: "fixed", zIndex: "99999", bottom: "16px", left: "278px", width: "min(890px, calc(100vw - 320px))", padding: "15px 20px", background: "#103c30", color: "white", border: "1px solid #5b9875", borderRadius: "14px", boxShadow: "0 6px 25px #0002", fontFamily: "system-ui", pointerEvents: "none" });
      const heading = document.createElement("strong"), detail = document.createElement("div");
      Object.assign(heading.style, { display: "block", fontSize: "18px", marginBottom: "5px" });
      Object.assign(detail.style, { fontSize: "15px", color: "#d9ece0", lineHeight: "1.4" });
      box.append(heading, detail); document.body.append(box);
    }
    box.children[0].textContent = String(number).padStart(2, "0") + " · " + title;
    box.children[1].textContent = note;
  }, { title, note, number });
  const step = async (title, note, seconds, action) => {
    const at = performance.now();
    chapters.push({ title, startMs: chapters.length ? Math.round(at - start) : 0 });
    console.log("Grabando " + chapters.length + ": " + title);
    await callout(title, note, chapters.length);
    await pause(900); await action();
    await page.waitForTimeout(Math.max(1200 * pace, seconds * 1000 * pace - (performance.now() - at)));
  };
  const open = async (text) => { const locator = page.getByText(text, { exact: true }); await show(locator); await locator.click(); await pause(650); };
  const fill = async (selector, data) => {
    for (const [name, value] of Object.entries(data)) {
      const el = page.locator(selector).locator(`[name="${name}"]`); await show(el);
      const kind = await el.evaluate((e) => e.tagName === "SELECT" ? "select" : e.type);
      if (kind === "select") await el.selectOption(String(value));
      else if (kind === "text" || kind === "textarea") { await el.fill(""); await el.pressSequentially(String(value), { delay: 32 * pace }); }
      else await el.fill(String(value));
      await pause(500);
    }
  };
  const save = async (selector, label) => {
    const el = page.locator(selector).getByRole("button", { name: label, exact: true });
    await show(el); await pause(1800); await el.click();
    await page.waitForFunction(() => !document.querySelector('form button[type="submit"]:disabled'));
    await pause(1600);
  };
  const go = async (name) => { await button(name).click(); await page.locator("main h1").waitFor(); await pause(1000); await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await pause(600); };
  const login = async (role) => {
    await page.getByLabel("Correo electrónico").pressSequentially(role + "@demo.foodsave.test", { delay: 40 * pace });
    await page.getByLabel("Contraseña", { exact: true }).fill(password); await pause(1300); await button("Entrar").click(); await button("Cerrar sesión").waitFor(); await pause(1000);
  };
  const shot = async (name) => page.screenshot({ path: directory + "/qa/" + name + ".png" });
  const download = async (name) => {
    const el = page.getByRole("link", { name, exact: true }); await show(el); await pause(1500);
    const [file] = await Promise.all([page.waitForEvent("download"), el.click()]);
    await file.saveAs(directory + "/" + file.suggestedFilename());
    const text = await readFile(await file.path(), "utf8"); await pause(2000); return text;
  };

  await page.goto(origin);
  await step("FoodSave · Negocios y licencias", "Flujo real con datos ficticios. Grabación pausada, sin narración y sin modificar la base de uso local.", 14, () => login("administrador"));
  await step("Registrar un negocio sostenible", "Iniciativa del comedor: responsable, presupuesto y ODS 2 (Hambre cero) y 12 (Consumo responsable).", 23, async () => {
    await go("Negocios e impacto"); await open("+ Registrar negocio");
    await fill("#business-create", { name: "Comedor circular DEMO", kind: "initiative", owner_id: users.editor, amount: "2500", currency: "DOP", description: "Recuperar alimentos y mejorar el acceso a comidas del comedor." });
    for (const id of [2, 12]) { const el = page.locator(`#business-create [name="sdg"][value="${id}"]`); await show(el); await el.check(); await pause(750); }
    await save("#business-create", "Crear negocio"); await show(page.locator("#business-detail"));
  });
  const business = app.db.prepare("SELECT * FROM businesses").get(); assert.equal(business.status, "draft");
  await step("Crear un proyecto con responsable y fechas", "El proyecto organiza el plan semanal de rescate de alimentos. Al crearlo queda planificado.", 17, async () => {
    await open("+ Crear proyecto"); await fill("#project-create", { name: "Plan semanal de rescate", owner_id: users.editor, starts_on: date, ends_on: day(7) }); await save("#project-create", "Crear proyecto");
  });
  await step("Activar el negocio", "Los cambios del ciclo de vida se guardan con control de versión e historial.", 17, async () => {
    await open("Editar datos y ciclo de vida"); await fill("#business-edit", { status: "active" }); await save("#business-edit", "Guardar negocio"); await show(page.locator("#business-detail"));
  });
  const project = app.db.prepare("SELECT * FROM business_projects").get();
  await step("Iniciar el proyecto", "Primero se activa el negocio; después se inicia su proyecto.", 12, async () => {
    await open("Plan semanal de rescate · Planificado"); await fill(`#project-${project.id}`, { status: "active" }); await save(`#project-${project.id}`, "Guardar proyecto");
  });
  const metrics = [
    { name: "Alimentos recuperados", dimension: "environmental", label: "ambiental", unit: "kg", target: "100", value: "40", sdg_id: "12" },
    { name: "Comidas entregadas", dimension: "social", label: "social", unit: "comidas", target: "200", value: "80", sdg_id: "2" },
    { name: "Ahorro registrado", dimension: "economic", label: "económico", unit: "DOP", target: "5000", value: "1800", sdg_id: "12" },
  ];
  for (const metric of metrics) {
    await step("Definir el indicador " + metric.label, `${metric.name}: base 0, meta ${metric.target} ${metric.unit}, ODS ${metric.sdg_id} y fecha límite.`, 16, async () => {
      await open("+ Definir indicador"); await fill("#indicator-create", { name: metric.name, dimension: metric.dimension, sdg_id: metric.sdg_id, project_id: project.id, unit: metric.unit, baseline: "0", target: metric.target, due_on: day(7) }); await save("#indicator-create", "Definir indicador");
    });
    const indicator = app.db.prepare("SELECT id FROM business_indicators WHERE name=?").get(metric.name).id;
    await step("Registrar medición con evidencia · " + metric.label, `Valor ficticio: ${metric.value} ${metric.unit}. Se conserva la fecha, la fuente y la persona que registró la medición.`, 12, async () => {
      const control = page.locator(`#measurement-${indicator}`).locator("..").getByText("Registrar medición", { exact: true }); await show(control); await control.click();
      await fill(`#measurement-${indicator}`, { value: metric.value, measured_on: date, evidence: "Demostración sintética; acta DEMO-01 del comedor." }); await save(`#measurement-${indicator}`, "Guardar medición");
    });
  }
  await step("Consultar el impacto en tres dimensiones", "40% de la meta ambiental, 40% de la social y 36% de la económica. Cada unidad se interpreta por separado.", 12, async () => {
    await show(page.getByRole("heading", { name: "Indicadores de impacto", exact: true })); await shot("impacto"); assert.equal(app.db.prepare("SELECT COUNT(*) n FROM indicator_measurements").get().n, 3);
  });
  await step("Descargar el reporte de impacto", "El CSV contiene negocio, ODS, metas, valores medidos y sus evidencias.", 12, async () => {
    assert.match(await download("Reporte de impacto CSV"), /Alimentos recuperados/);
  });
  await step("Completar proyecto y negocio", "Un negocio no se completa con proyectos pendientes: primero se termina el proyecto y luego el negocio.", 18, async () => {
    await open("Plan semanal de rescate · Activo"); await fill(`#project-${project.id}`, { status: "completed" }); await save(`#project-${project.id}`, "Guardar proyecto");
    await open("Editar datos y ciclo de vida"); await fill("#business-edit", { status: "completed" }); await save("#business-edit", "Guardar negocio"); await show(page.locator("#business-detail"));
    assert.equal(app.db.prepare("SELECT status FROM businesses").get().status, "completed");
  });
  await step("Registrar software y proveedor", "El catálogo identifica los recursos digitales. Registrarlos aquí no compra ni activa licencias externas.", 15, async () => {
    await go("Software y licencias"); await open("+ Registrar software"); await fill("#software-create", { name: "FoodSave Analítica DEMO", vendor: "Proveedor de demostración" }); await save("#software-create", "Guardar software");
  });
  await step("Registrar un equipo y un área", "Las licencias pueden asociarse a personas, equipos identificados o áreas de trabajo.", 22, async () => {
    for (const kind of ["equipment", "area"]) { await open("+ Registrar equipo o área"); await fill("#target-create", { kind, name: kind === "equipment" ? "Equipo comedor 01" : "Área de logística" }); await save("#target-create", "Guardar recurso"); }
  });
  await step("Registrar contrato y vigencia", "Tres cupos, costo de RD$1,800 y vencimiento en siete días. El contrato queda asociado al negocio.", 20, async () => {
    await open("+ Registrar licencia"); await fill("#license-create", { reference: "DEMO-LICENCIA-001", business_id: business.id, seats: "3", starts_on: date, expires_on: day(7), amount: "1800" }); await save("#license-create", "Guardar licencia"); await show(page.locator("#license-detail"));
  });
  const license = app.db.prepare("SELECT * FROM business_licenses").get();
  const targets = app.db.prepare("SELECT * FROM license_targets ORDER BY id").all();
  const destinations = [{ value: "user:" + users.editor, label: "usuario Carlos Méndez" }, ...targets.map((target) => ({ value: "target:" + target.id, label: target.name }))];
  for (const destination of destinations) await step("Asignar un cupo · " + destination.label, "Cada asignación ocupa un cupo del contrato y registra quién la realizó y cuándo.", 12, async () => {
    await open("+ Asignar licencia"); await fill("#assignment-create", { destination: destination.value, seats: "1" }); await save("#assignment-create", "Asignar cupos"); await show(page.getByRole("heading", { name: "Asignaciones", exact: true }));
  });
  await step("Comprobar que no quedan cupos", "Tres asignados de tres contratados. No se permiten nuevas asignaciones hasta liberar o ampliar capacidad.", 10, async () => {
    assert.equal(await page.locator("#assignment-create").count(), 0); await show(page.locator("#license-detail")); await shot("capacidad");
  });
  const assignment = app.db.prepare("SELECT id FROM license_assignments WHERE user_id IS NOT NULL").get().id;
  await step("Liberar la asignación de un usuario", "El motivo queda en el historial. Se recupera un cupo sin borrar la asignación anterior.", 15, async () => {
    const control = page.locator(`#release-${assignment}`).locator("..").getByText("Liberar cupos", { exact: true }); await show(control); await control.click(); await fill(`#release-${assignment}`, { note: "Fin de participación de la persona de demostración" }); await save(`#release-${assignment}`, "Liberar asignación"); await show(page.locator("#license-detail"));
  });
  await step("Consultar próximos vencimientos y reportes", "Filtra contratos que vencen en 30 días. Descarga los CSV de vigencias y de uso con sus asignaciones.", 18, async () => {
    await fill("#license-filters", { state: "expiring", days: "30" }); await button("Filtrar licencias").click(); await page.locator("[data-license]").waitFor(); await pause(1800);
    for (const name of ["Reporte de vencimientos CSV", "Reporte de uso CSV"]) assert.match(await download(name), /DEMO-LICENCIA-001/);
    await shot("vencimientos");
  });
  await step("Renovar la vigencia del contrato", "Extendemos el vencimiento a 90 días. Se conservan las dos asignaciones activas y la liberación anterior.", 15, async () => {
    await page.locator("[data-license]").click(); await page.locator("#license-detail").waitFor(); await open("Renovar o editar licencia"); await fill("#license-edit", { expires_on: day(90) }); await save("#license-edit", "Actualizar licencia");
    await show(page.locator("#license-detail")); assert.equal(app.db.prepare("SELECT expires_on FROM business_licenses").get().expires_on, day(90));
  });
  await step("Verificar el efecto de la renovación", "El contrato renovado deja de aparecer entre los que vencen en los próximos 30 días.", 10, async () => {
    await show(page.locator("#license-filters")); await button("Filtrar licencias").click(); await page.waitForFunction(() => document.querySelectorAll("[data-license]").length === 0); await pause(2500);
    await fill("#license-filters", { state: "" }); await button("Filtrar licencias").click(); await page.locator("[data-license]").waitFor();
  });
  await step("Consultar historial de licencias", "Creación, asignaciones, liberación y renovación conservan actor, fecha y datos del cambio.", 12, async () => {
    await page.locator("[data-license]").click(); await open("Historial de cambios · 6"); await show(page.locator(".business-history")); await shot("historial");
  });
  await step("Acceso de consulta para supervisión", "El supervisor puede consultar y descargar reportes. Las acciones para crear y asignar están restringidas.", 20, async () => {
    await button("Cerrar sesión").click(); await page.getByRole("heading", { name: "Iniciar sesión", exact: true }).waitFor(); await login("supervisor"); await go("Software y licencias");
    assert.equal(await page.getByText("+ Registrar licencia", { exact: true }).count(), 0); assert.equal(await page.getByRole("link", { name: "Reporte de uso CSV" }).count(), 1); await shot("supervision");
  });
  await step("Cierre del flujo de demostración", "Negocios con resultados medibles y licencias con cupos, vigencias, reportes e historial. Datos ficticios de clase.", 8, async () => { await button("Cerrar sesión").click(); await page.getByRole("heading", { name: "Iniciar sesión", exact: true }).waitFor(); });
  assert.deepEqual(errors, []);
  const video = page.video(); await context.close(); await video.saveAs(directory + "/flujo-negocios-licencias.webm"); await video.delete();
  await writeFile(directory + "/capitulos.json", JSON.stringify(chapters, null, 2));
  await writeFile(directory + "/verification.json", JSON.stringify({ result: "passed", errors, chapters: chapters.length, businessStatus: app.db.prepare("SELECT status FROM businesses").get().status, dimensions: app.db.prepare("SELECT dimension FROM business_indicators ORDER BY dimension").all(), measurements: 3, assignments: 3, released: 1, activeAssignments: 2, renewedUntil: day(90), apiExternal: false, syntheticData: true }, null, 2));
  console.log("Grabación verificada y completada.");
} finally { await browser?.close(); await new Promise((r) => app.server.close(r)); app.db.close(); }
