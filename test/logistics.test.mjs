import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { hashPassword, openStore } from "../store.mjs";

const password = "Fixture-prueba-logistica-2026!",
  hash = await hashPassword(password),
  origin = "http://localhost:3000",
  sample = { name: "Arroz integral", category: "Otros", expires: "2099-11-12", quantity: 10 };
const insertUser = (db, role) => Number(db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
  .run(role, role + "@example.test", hash, role).lastInsertRowid);

async function setup(t) {
  const { server, db } = await createApp({ database: ":memory:", origin });
  const users = Object.fromEntries(["administrador", "editor", "supervisor", "lector"].map((role) => [role, insertUser(db, role)]));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const request = async (path, { method = "GET", body, cookie, csrf, site = origin } = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
      method,
      headers: { Origin: site, "Content-Type": "application/json", ...(cookie && { Cookie: cookie }), ...(csrf && { "X-CSRF-Token": csrf }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    const content = await res.text();
    return { status: res.status, headers: res.headers, body: res.headers.get("content-type").includes("json") ? JSON.parse(content) : content };
  };
  const login = async (role = "administrador") => {
    const result = await request("login", { method: "POST", body: { email: role + "@example.test", password } });
    assert.equal(result.status, 200);
    return { cookie: result.headers.get("set-cookie").split(";")[0], csrf: result.body.csrf };
  };
  const lot = async (session, values) => {
    const result = await request("inventory", { ...session, method: "POST", body: { ...sample, ...values } });
    assert.equal(result.status, 201);
    return result.body.id;
  };
  const move = (session, food_id, type, quantity, reason = "Entrega al comedor") =>
    request("logistics/movements", { ...session, method: "POST", body: { food_id, type, quantity, reason } });
  const stock = async (session, id) =>
    (await request("logistics/stock", session)).body.lots.find((l) => l.id === id);
  const history = async (session, query = "") =>
    (await request("logistics/movements?" + query, session)).body;
  return { request, login, lot, move, stock, history, users, db };
}

test("GL-01/02 registra un lote y actualiza el inventario compartido con entrada y salida", async (t) => {
  const { request, login, lot, move, stock, history, db } = await setup(t);
  const editor = await login("editor");
  const id = await lot(editor);
  assert.equal((await move(editor, id, "entry", 5, "Reposición de despensa")).status, 201);
  assert.equal((await move(editor, id, "exit", 4)).status, 201);
  assert.equal((await stock(editor, id)).available, 11);
  assert.equal((await request("inventory", editor)).body.foods[0].quantity, 11);
  const movements = (await history(editor)).movements;
  assert.deepEqual(movements.map((m) => [m.type, m.source, m.before_qty, m.after_qty]), [
    ["exit", "logistics", 15, 11], ["entry", "logistics", 10, 15], ["entry", "inventory", 0, 10],
  ]);
  assert.equal(movements[0].actor_name, "editor");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM audit WHERE action='logistics.movement'").get().total, 2);
});

test("GL-03 bloquea salida excesiva, entrada sobre límite, datos inválidos y lotes vencidos o agotados", async (t) => {
  const { login, lot, move, stock, history } = await setup(t);
  const admin = await login();
  const id = await lot(admin);
  const expired = await lot(admin, { expires: "2000-01-01" });
  assert.equal((await move(admin, id, "exit", 11)).status, 409);
  assert.equal((await move(admin, id, "entry", 9991)).status, 409);
  assert.equal((await move(admin, id, "exit", 0)).status, 400);
  assert.equal((await move(admin, id, "exit", 1.5)).status, 400);
  assert.equal((await move(admin, id, "exit", 1, "   ")).status, 400);
  assert.equal((await move(admin, id, "opening", 1)).status, 400);
  assert.equal((await move(admin, 999, "exit", 1)).status, 404);
  assert.equal((await move(admin, expired, "exit", 1)).status, 409);
  assert.equal((await move(admin, expired, "entry", 1)).status, 409);
  const expiredStock = await stock(admin, expired);
  assert.equal(expiredStock.on_hand, 10);
  assert.equal(expiredStock.available, 0);
  assert.equal((await history(admin, "food_id=" + id)).movements.length, 1);
  assert.equal((await move(admin, id, "exit", 10)).status, 201);
  assert.equal((await stock(admin, id)).status, "distributed");
  assert.equal((await stock(admin, id)).on_hand, 0);
  assert.equal((await move(admin, id, "entry", 1)).status, 409);
});

test("GL-03 dos salidas concurrentes no producen saldo negativo ni duplican movimientos rechazados", async (t) => {
  const { login, lot, move, stock, history } = await setup(t);
  const admin = await login();
  const id = await lot(admin);
  const result = await Promise.all([move(admin, id, "exit", 7), move(admin, id, "exit", 7)]);
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await stock(admin, id)).available, 3);
  assert.equal((await history(admin, "type=exit")).movements.length, 1);
});

test("GL-04/05 filtra por lote, fecha local y tipo; pagina historial y exporta todas las filas filtradas", async (t) => {
  const { request, login, lot, move, history, db } = await setup(t);
  const admin = await login();
  const id = await lot(admin, { name: "=FÓRMULA" });
  const other = await lot(admin, { name: "Otro producto" });
  assert.equal((await move(admin, other, "entry", 1)).status, 201);
  for (let i = 0; i < 51; i++)
    assert.equal((await move(admin, id, "entry", 1, "=Motivo " + i)).status, 201);
  db.exec("UPDATE stock_movements SET created_at='2026-11-10 12:00:00'");
  db.prepare("UPDATE stock_movements SET created_at='2026-11-12 02:00:00' WHERE food_id=? AND source='logistics'").run(id);
  const query = `food_id=${id}&type=entry&from=2026-11-11&to=2026-11-11`;
  const first = await history(admin, query);
  assert.equal(first.movements.length, 50);
  const last = await history(admin, query + "&before=" + first.next);
  assert.equal(last.movements.length, 1);
  assert.equal(last.next, null);
  assert.equal((await request("logistics/movements?from=2026-02-30", admin)).status, 400);
  assert.equal((await request("logistics/movements?from=2026-11-12&to=2026-11-11", admin)).status, 400);
  const csv = await request("logistics/movements.csv?" + query, admin);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /foodsave-movimientos\.csv/);
  assert.match(csv.body, /"'=FÓRMULA"/);
  assert.match(csv.body, /"'=Motivo 0"/);
  assert.doesNotMatch(csv.body, /Otro producto/);
  assert.equal(csv.body.trim().split("\r\n").length, 52);
  const stock = await request("logistics/stock.csv", admin);
  assert.match(stock.body, /"61","61"/);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM audit WHERE action='logistics.report'").get().total, 2);
});

test("GL-06 aplica sesión, origen, CSRF y permisos de lectura, movimiento y reporte", async (t) => {
  const { request, login, lot, move } = await setup(t);
  assert.equal((await request("logistics/stock")).status, 401);
  const editor = await login("editor"), supervisor = await login("supervisor"), lector = await login("lector");
  const id = await lot(editor);
  assert.equal((await request("logistics/stock", supervisor)).status, 200);
  assert.equal((await request("logistics/stock", lector)).status, 403);
  assert.equal((await move(supervisor, id, "exit", 1)).status, 403);
  assert.equal((await move({ ...editor, csrf: null }, id, "exit", 1)).status, 403);
  assert.equal((await move({ ...editor, site: "http://example.test" }, id, "exit", 1)).status, 403);
  assert.equal((await request("logistics/stock.csv", editor)).status, 403);
  assert.equal((await request("logistics/stock.csv", supervisor)).status, 200);
  assert.equal((await request("logistics/movements.csv", lector)).status, 403);
});

test("GL-07 integra cierre operativo una sola vez y registra también la salida desde Inventario", async (t) => {
  const { request, login, lot, move, stock, history, users } = await setup(t);
  const admin = await login(), id = await lot(admin);
  const operation = await request("operations", { ...admin, method: "POST", body: {
    title: "Consumo de prueba logística", type: "consumo", food_id: id, quantity: 4,
    responsible_id: users.administrador, scheduled_date: "2099-01-01", notes: "",
  } });
  assert.equal(operation.status, 201);
  const op = operation.body.operation.id;
  const action = (verb, expected_version) => request(`operations/${op}/${verb}`, { ...admin, method: "POST",
    body: { expected_version, ...(verb === "start" ? {} : { note: "Consumo registrado" }) } });
  assert.equal((await action("start", 1)).status, 200);
  assert.equal((await move(admin, id, "exit", 7)).status, 201);
  assert.equal((await action("close", 2)).status, 409);
  assert.equal((await stock(admin, id)).available, 3);
  assert.equal((await move(admin, id, "entry", 2)).status, 201);
  assert.equal((await action("close", 2)).status, 200);
  assert.equal((await action("close", 2)).status, 409);
  assert.equal((await stock(admin, id)).available, 1);
  assert.equal((await request("inventory/" + id, { ...admin, method: "PATCH", body: { status: "wasted" } })).status, 200);
  const movements = (await history(admin)).movements;
  assert.deepEqual(movements.slice(0, 2).map((m) => [m.source, m.before_qty, m.after_qty, m.operation_id]), [
    ["inventory", 1, 0, null], ["operation", 5, 1, op],
  ]);
  assert.equal(movements.filter((m) => m.operation_id === op).length, 1);
});

test("GL-07 revierte stock y auditoría si el movimiento no puede persistir", async (t) => {
  const { request, login, lot, move, db, stock, history } = await setup(t);
  const admin = await login(), id = await lot(admin);
  db.exec("CREATE TRIGGER test_block_exit BEFORE INSERT ON stock_movements WHEN NEW.type='exit' BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  // Trigger simulates a storage error after the UPDATE within the transaction.
  const previous = console.error;
  console.error = () => {};
  try { assert.equal((await move(admin, id, "exit", 4)).status, 500); }
  finally { console.error = previous; }
  assert.equal((await stock(admin, id)).available, 10);
  assert.equal((await history(admin)).movements.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM audit WHERE action='logistics.movement'").get().total, 0);
});

test("GL-08 migra saldos existentes sin inventar movimientos históricos ni sobrescribir permisos personalizados", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "foodsave-logistics-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "demo.sqlite");
  let db = openStore(file);
  const editor = insertUser(db, "editor");
  db.exec("DROP TABLE stock_movements; DELETE FROM schema_migrations WHERE id='logistics-v1'");
  db.prepare("UPDATE roles SET permissions=? WHERE id='editor'").run(JSON.stringify(["inventory.manage"]));
  db.prepare("INSERT INTO sessions VALUES ('editor-session',?,'csrf',9999999999999)").run(editor);
  const insert = db.prepare("INSERT INTO foods(name,category,quantity,expires,status,created_by) VALUES ('Arroz','Otros',?,'2099-11-12',?,?)");
  insert.run(12, "available", editor);
  insert.run(9, "wasted", editor);
  db.close();
  for (let i = 0; i < 2; i++) {
    db = openStore(file);
    const movements = db.prepare("SELECT food_id,type,after_qty,actor_id FROM stock_movements").all();
    assert.deepEqual(movements.map((m) => [m.food_id, m.type, m.after_qty, m.actor_id]), [[1, "opening", 12, null]]);
    assert.equal(db.prepare("SELECT count(*) total FROM foods").get().total, 2);
    assert.deepEqual(JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id='editor'").get().permissions),
      ["inventory.manage", "logistics.read", "logistics.move"]);
    assert.equal(db.prepare("SELECT count(*) total FROM sessions").get().total, 0);
    db.close();
  }
});
