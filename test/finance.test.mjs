import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
import { todayDO } from "../finance-store.mjs";

const password = "Finanzas-prueba-2026!";
const hash = await hashPassword(password);
const date = todayDO();
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCO8AAAAASUVORK5CYII=";
const draft = {
  raw_text: "Arroz 2 x 50.00", currency: "DOP", purchased_on: date, warnings: [],
  products: [{ name: "Arroz", category: "Otros", quantity: 2, unit_cost_cents: 5000, expires: null, note: "Revisar vencimiento" }],
};
async function setup(t, ai = async () => structuredClone(draft)) {
  const app = await createApp({ database: ":memory:", origin: "http://localhost:3000", ai });
  const users = {};
  for (const role of ["administrador", "editor", "supervisor", "lector"])
    users[role] = Number(app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
      .run(role, role + "@example.test", hash, role).lastInsertRowid);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
  });
  const request = async (path, session = {}, method = "GET", body) => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, {
      method, headers: { Origin: "http://localhost:3000", "Content-Type": "application/json",
        ...(session.cookie && { Cookie: session.cookie }), ...(session.csrf && { "X-CSRF-Token": session.csrf }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    return { status: r.status, headers: r.headers, body: r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const login = async (role = "administrador") => {
    const result = await request("login", {}, "POST", { email: role + "@example.test", password });
    assert.equal(result.status, 200);
    return { cookie: result.headers.get("set-cookie").split(";")[0], csrf: result.body.csrf };
  };
  const lot = async (session, changes = {}) => {
    const r = await request("inventory", session, "POST", {
      name: "Arroz", category: "Otros", quantity: 10, expires: date, unit_cost_cents: 2500, ...changes,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  return { ...app, request, login, lot, users };
}

test("FI-01 compras, consumos, distribución y descarte conservan costos sin contar el gasto dos veces", async (t) => {
  const { request, login, lot, db, users } = await setup(t);
  const admin = await login(), food = await lot(admin);
  assert.equal((await request("logistics/movements", admin, "POST", { food_id: food, type: "entry", quantity: 5, reason: "Reposición mensual" })).status, 201);
  assert.equal((await request("logistics/movements", admin, "POST", { food_id: food, type: "exit", quantity: 2, reason: "Entrega al comedor" })).status, 201);
  const op = await request("operations", admin, "POST", {
    title: "Consumo para finanzas", type: "consumo", food_id: food, quantity: 3,
    responsible_id: users.editor, scheduled_date: date, notes: "",
  });
  assert.equal(op.status, 201);
  const id = op.body.operation.id;
  assert.equal((await request(`operations/${id}/start`, admin, "POST", { expected_version: 1 })).status, 200);
  assert.equal((await request(`operations/${id}/close`, admin, "POST", { expected_version: 2, note: "Consumo confirmado" })).status, 200);
  assert.equal((await request("inventory/" + food, admin, "PATCH", { status: "wasted" })).status, 200);
  const { summary } = (await request("finance/summary", admin)).body;
  assert.equal(summary.spending_cents, 37500);
  assert.equal(summary.waste_cents, 25000);
  assert.equal(summary.inventory_value_cents, 0);
  assert.deepEqual(db.prepare("SELECT kind,total_cents FROM financial_movements ORDER BY movement_id").all()
    .map((row) => [row.kind, row.total_cents]),
    [["purchase", 25000], ["purchase", 12500], ["distribution", 5000], ["consumption", 7500], ["waste", 25000]]);
});

test("FI-02 valora riesgo y vencidos, identifica datos sin costo y no reconstruye compras antiguas", async (t) => {
  const { request, login, lot, db } = await setup(t);
  const admin = await login();
  await lot(admin);
  await lot(admin, { name: "Vencido", expires: "2000-01-01", quantity: 2, unit_cost_cents: 1000 });
  const missing = await lot(admin, { name: "Costo pendiente", quantity: 4, unit_cost_cents: null });
  let data = (await request("finance/summary", admin)).body;
  assert.equal(data.summary.risk_cents, 25000);
  assert.equal(data.summary.expired_value_cents, 2000);
  assert.equal(data.summary.unpriced_lots, 1);
  assert.equal(data.summary.unpriced_movements, 1);
  assert.equal((await request("finance/lot-costs", admin, "POST", { food_id: missing, unit_cost_cents: 500 })).status, 201);
  data = (await request("finance/summary", admin)).body;
  assert.equal(data.summary.spending_cents, 27000);
  assert.equal(data.summary.inventory_value_cents, 29000);
  assert.equal(data.summary.unpriced_lots, 0);
  assert.equal(data.summary.unpriced_movements, 1);
  assert.equal((await request("finance/lot-costs", admin, "POST", { food_id: missing, unit_cost_cents: 800 })).status, 409);
  db.prepare("UPDATE stock_movements SET created_at='2030-04-01 02:00:00' WHERE food_id=?").run(missing);
  const previousMonth = (await request("finance/summary?month=2030-03", admin)).body;
  assert.equal(previousMonth.movements[0].booked_on, "2030-03-31");
});

test("FI-03 presupuesto con versión y registros de ayudas/gastos idempotentes por mes", async (t) => {
  const { request, login, lot } = await setup(t);
  const admin = await login(), month = date.slice(0, 7);
  await lot(admin);
  const budget = { month, amount_cents: 100000, expected_version: 0 };
  const saved = await Promise.all([request("finance/budget", admin, "PUT", budget), request("finance/budget", admin, "PUT", budget)]);
  assert.deepEqual(saved.map((r) => r.status).sort(), [200, 409]);
  const record = { kind: "aid", description: "Donación familiar", amount_cents: 20000, booked_on: date, request_id: randomUUID() };
  const first = await request("finance/records", admin, "POST", record);
  const repeated = await request("finance/records", admin, "POST", record);
  assert.equal(first.status, 201);
  assert.equal(first.body.id, repeated.body.id);
  assert.equal((await request("finance/records", admin, "POST", { ...record, amount_cents: 30000 })).status, 409);
  assert.equal((await request("finance/records", admin, "POST", { ...record, kind: "expense", amount_cents: 5000, request_id: randomUUID() })).status, 201);
  const data = (await request("finance/summary", admin)).body;
  assert.equal(data.summary.spending_cents, 30000);
  assert.equal(data.summary.aid_cents, 20000);
  assert.equal(data.summary.out_of_pocket_cents, 10000);
  assert.equal(data.summary.remaining_cents, 90000);
  assert.equal((await request("finance/summary?month=2000-01", admin)).body.summary.spending_cents, 0);
});

test("FI-04 valida centavos, fechas, campos y permisos; exporta CSV protegido", async (t) => {
  const { request, login, lot } = await setup(t);
  const admin = await login(), editor = await login("editor"), supervisor = await login("supervisor"), reader = await login("lector");
  assert.equal((await request("finance/summary")).status, 401);
  assert.equal((await request("finance/summary", reader)).status, 403);
  assert.equal((await request("finance/summary", supervisor)).status, 200);
  assert.equal((await request("finance/export.csv", editor)).status, 403);
  assert.equal((await request("finance/export.csv", supervisor)).status, 200);
  const invalid = await request("inventory", admin, "POST", {
    name: "Arroz", category: "Otros", quantity: 1, expires: date, unit_cost_cents: 1.5,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await request("finance/summary?month=2026-13", admin)).status, 400);
  assert.equal((await request("finance/budget", supervisor, "PUT", { month: date.slice(0, 7), amount_cents: 500, expected_version: 0 })).status, 403);
  const id = await lot(admin, { name: "=FORMULA" });
  assert.equal((await request("finance/lot-costs", { cookie: admin.cookie }, "POST", { food_id: id, unit_cost_cents: 20 })).status, 403);
  const readerInventory = await request("inventory", reader);
  assert.equal(Object.hasOwn(readerInventory.body.foods[0], "unit_cost_cents"), false);
  const supervisorInventory = await request("inventory", supervisor);
  assert.equal(supervisorInventory.body.foods[0].unit_cost_cents, 2500);
  const csv = await request("finance/export.csv", admin);
  assert.match(csv.body, /"'=FORMULA"/);
});

test("FI-05 el error de persistir el costo revierte también la entrada y el inventario", async (t) => {
  const { request, login, lot, db } = await setup(t);
  const admin = await login(), food = await lot(admin);
  db.exec("CREATE TRIGGER test_financial_failure BEFORE INSERT ON financial_movements BEGIN SELECT RAISE(ABORT,'test'); END");
  const previous = console.error;
  console.error = () => {};
  try {
    assert.equal((await request("logistics/movements", admin, "POST", { food_id: food, type: "entry", quantity: 2, reason: "Compra fallida" })).status, 500);
  } finally { console.error = previous; }
  assert.equal(db.prepare("SELECT quantity FROM foods WHERE id=?").get(food).quantity, 10);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM stock_movements").get().total, 1);
});

test("IA-01 lectura OCR produce borrador; confirmar requiere revisión y guarda un lote con costo una sola vez", async (t) => {
  let calls = 0;
  const { request, login, db } = await setup(t, async () => { calls++; return structuredClone(draft); });
  const editor = await login("editor");
  const analyzed = await request("imports/analyze", editor, "POST", { image });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.body.draft.products[0].expires, null);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM foods").get().total, 0);
  await request("imports/analyze", editor, "POST", { image });
  assert.equal(calls, 1);
  const data = { id: analyzed.body.id, products: [{ name: "Arroz", category: "Otros", quantity: 2, expires: date, unit_cost_cents: 5000 }] };
  const results = await Promise.all([request("imports/confirm", editor, "POST", data), request("imports/confirm", editor, "POST", data)]);
  assert.deepEqual(results.map((r) => r.status), [201, 201]);
  assert.deepEqual(results[0].body.food_ids, results[1].body.food_ids);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM foods").get().total, 1);
  assert.equal(db.prepare("SELECT SUM(total_cents) total FROM financial_movements").get().total, 10000);
  assert.equal((await request("imports/analyze", editor, "POST", { image })).body.status, "committed");
});

test("IA-02 permisos, propietario, vencimiento, imagen y confirmación atómica bloquean importaciones inválidas", async (t) => {
  const { request, login, db } = await setup(t);
  const admin = await login(), editor = await login("editor"), supervisor = await login("supervisor");
  assert.equal((await request("imports/analyze", supervisor, "POST", { image })).status, 403);
  assert.equal((await request("imports/analyze", editor, "POST", { image: "https://untrusted.example/photo.png" })).status, 400);
  assert.equal((await request("imports/analyze", editor, "POST", { image: "data:image/png;base64,AAAA" })).status, 400);
  const analyzed = await request("imports/analyze", editor, "POST", { image });
  const products = [{ name: "Arroz", category: "Otros", quantity: 2, expires: date, unit_cost_cents: 5000 }];
  assert.equal((await request("imports/confirm", admin, "POST", { id: analyzed.body.id, products })).status, 404);
  assert.equal((await request("imports/confirm", editor, "POST", { id: analyzed.body.id, products: [...products, { ...products[0], quantity: 0 }] })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM foods").get().total, 0);
  db.prepare("UPDATE product_imports SET created_at=?").run(Date.now() - 1900000);
  assert.equal((await request("imports/confirm", editor, "POST", { id: analyzed.body.id, products })).status, 410);
});

test("IA-03 fallo de IA es recuperable, las respuestas se validan y el límite por usuario se aplica", async (t) => {
  let success = false;
  const { request, login, db } = await setup(t, async () => {
    if (!success) throw Object.assign(new Error("Servicio no disponible"), { status: 503 });
    return structuredClone(draft);
  });
  const editor = await login("editor");
  assert.equal((await request("imports/analyze", editor, "POST", { image })).status, 503);
  success = true;
  assert.equal((await request("imports/analyze", editor, "POST", { image })).status, 200);
  db.prepare("DELETE FROM product_imports").run();
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO ai_requests(actor_id,kind,created_at) SELECT id,'test',? FROM users WHERE role='editor'").run(Date.now());
  assert.equal((await request("imports/analyze", editor, "POST", { image })).status, 429);
});

test("IA-04 sugerencias usan resumen calculado, se protegen por perfil y no realizan cambios", async (t) => {
  const { request, login, lot, db } = await setup(t, async (input) => {
    assert.equal(JSON.parse(input.input).summary.spending_cents, 25000);
    return { summary: "Revisa los alimentos que vencen hoy.", actions: ["Utiliza el lote de arroz antes de su vencimiento."] };
  });
  const admin = await login(), reader = await login("lector");
  await lot(admin);
  assert.equal((await request("finance/advice", reader, "POST", {})).status, 403);
  const result = await request("finance/advice", admin, "POST", {});
  assert.equal(result.status, 200);
  assert.equal(result.body.actions.length, 1);
  assert.equal(db.prepare("SELECT quantity FROM foods").get().quantity, 10);
});

test("IA-05 rechaza datos malformados del proveedor antes de mostrar o guardar una lectura", async (t) => {
  let malformed = true;
  const { request, login, db } = await setup(t, async () => {
    const value = structuredClone(draft);
    if (malformed) value.products[0].unit_cost_cents = -500;
    return value;
  });
  const editor = await login("editor");
  assert.equal((await request("imports/analyze", editor, "POST", { image })).status, 502);
  assert.equal(db.prepare("SELECT status FROM product_imports").get().status, "failed");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM foods").get().total, 0);
  malformed = false;
  assert.equal((await request("imports/analyze", editor, "POST", { image })).status, 200);
});
