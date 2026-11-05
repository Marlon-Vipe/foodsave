import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { hashPassword, openStore } from "../store.mjs";
const password = "Operaciones-seguras-2026!",
  hash = await hashPassword(password),
  day = "2099-12-01";
async function setup(t) {
  const a = await createApp({
    database: ":memory:",
    origin: "http://localhost:3000",
  });
  const users = {};
  for (const role of ["administrador", "editor", "supervisor", "lector"])
    users[role] = Number(
      a.db
        .prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
        .run("Prueba " + role, role + "@example.test", hash, role)
        .lastInsertRowid,
    );
  const food = Number(
    a.db
      .prepare(
        "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
      )
      .run("Arroz", "Otros", 10, "2099-12-31", users.administrador)
      .lastInsertRowid,
  );
  a.server.listen(0, "127.0.0.1");
  await once(a.server, "listening");
  t.after(async () => {
    await new Promise((resolve) => a.server.close(resolve));
    a.db.close();
  });
  const base = `http://127.0.0.1:${a.server.address().port}/api/`;
  const request = async (
    route,
    {
      method = "GET",
      body,
      cookie,
      csrf,
      origin = "http://localhost:3000",
    } = {},
  ) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: res.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : text,
      headers: res.headers,
    };
  };
  const session = async (role) => {
    const r = await request("login", {
      method: "POST",
      body: { email: role + "@example.test", password },
    });
    assert.equal(r.status, 200);
    return {
      cookie: r.headers.get("set-cookie").split(";")[0],
      csrf: r.body.csrf,
    };
  };
  const data = {
    title: "Consumo de cocina",
    type: "consumo",
    food_id: food,
    quantity: 3,
    responsible_id: users.editor,
    scheduled_date: day,
    notes: "Plan de consumo",
  };
  const create = async (s, changes = {}) => {
    const r = await request("operations", {
      ...s,
      method: "POST",
      body: { ...data, ...changes },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.operation;
  };
  const action = (s, o, name, note = "Verificado por supervisión") =>
    request("operations/" + o.id + "/" + name, {
      ...s,
      method: "POST",
      body: {
        expected_version: o.version,
        ...(name === "start" ? {} : { note }),
      },
    });
  return { ...a, users, food, request, session, data, create, action };
}
test("GO-01 Crea operación pendiente y persiste responsable y primera revisión", async (t) => {
  const a = await setup(t),
    s = await a.session("editor"),
    o = await a.create(s);
  assert.equal(o.status, "pendiente");
  assert.equal(o.version, 1);
  assert.equal(o.responsible_id, a.users.editor);
  const detail = await a.request("operations/" + o.id, s);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.history.length, 1);
  assert.equal(detail.body.history[0].before, null);
  assert.equal(detail.body.history[0].after.title, a.data.title);
  assert.equal(
    a.db.prepare("SELECT quantity FROM foods WHERE id=?").get(a.food).quantity,
    10,
  );
});
test("GO-01 Valida campos, cantidades, fechas, tipo, alimento y responsable", async (t) => {
  const a = await setup(t),
    s = await a.session("editor");
  for (const [change, status] of [
    [{ title: "x" }, 400],
    [{ quantity: 0 }, 400],
    [{ quantity: 1.5 }, 400],
    [{ quantity: 11 }, 409],
    [{ quantity: 10001 }, 400],
    [{ scheduled_date: "2026-02-30" }, 400],
    [{ scheduled_date: "x" }, 400],
    [{ type: "inventado" }, 400],
    [{ food_id: 999 }, 409],
    [{ responsible_id: a.users.lector }, 400],
    [{ status: "cerrada" }, 400],
    [{ notes: {} }, 400],
  ])
    assert.equal(
      (
        await a.request("operations", {
          ...s,
          method: "POST",
          body: { ...a.data, ...change },
        })
      ).status,
      status,
      JSON.stringify(change),
    );
  assert.equal(a.db.prepare("SELECT COUNT(*) n FROM operations").get().n, 0);
});
test("GO-02 Consulta por estado, rango de fecha prevista y responsable combinados", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  const first = await a.create(s);
  await a.create(s, {
    scheduled_date: "2099-11-30",
    responsible_id: a.users.administrador,
  });
  await a.action(s, first, "start");
  const filtered = await a.request(
    "operations?status=en_proceso&from=2099-12-01&to=2099-12-01&responsible_id=" +
      a.users.editor,
    s,
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.operations.length, 1);
  assert.equal(filtered.body.operations[0].id, first.id);
  assert.equal(
    (await a.request("operations?status=cerrada", s)).body.operations.length,
    0,
  );
});
test("GO-02 Rechaza filtros inválidos, rangos invertidos y claves duplicadas", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  for (const q of [
    "status=otro",
    "from=2026-02-30",
    "from=2099-12-02&to=2099-12-01",
    "responsible_id=-1",
    "responsible_id=1.5",
    "status=pendiente&status=cerrada",
    "sql=1",
  ])
    assert.equal((await a.request("operations?" + q, s)).status, 400, q);
});
test("GO-03 Actualiza campos con historial antes/después y control de versión", async (t) => {
  const a = await setup(t),
    s = await a.session("editor"),
    o = await a.create(s);
  const updated = await a.request("operations/" + o.id, {
    ...s,
    method: "PATCH",
    body: { expected_version: 1, title: "Consumo actualizado", quantity: 4 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.operation.version, 2);
  const stale = await a.request("operations/" + o.id, {
    ...s,
    method: "PATCH",
    body: { expected_version: 1, quantity: 2 },
  });
  assert.equal(stale.status, 409);
  const detail = (await a.request("operations/" + o.id, s)).body;
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[1].before.quantity, 3);
  assert.equal(detail.history[1].after.quantity, 4);
});
test("GO-03 Reasigna a un responsable habilitado y rechaza cuentas inactivas", async (t) => {
  const a = await setup(t),
    s = await a.session("editor"),
    o = await a.create(s);
  a.db
    .prepare("UPDATE users SET active=0 WHERE id=?")
    .run(a.users.administrador);
  assert.equal(
    (
      await a.request("operations/" + o.id, {
        ...s,
        method: "PATCH",
        body: { expected_version: 1, responsible_id: a.users.administrador },
      })
    ).status,
    400,
  );
  a.db
    .prepare("UPDATE users SET active=1 WHERE id=?")
    .run(a.users.administrador);
  assert.equal(
    (
      await a.request("operations/" + o.id, {
        ...s,
        method: "PATCH",
        body: { expected_version: 1, responsible_id: a.users.administrador },
      })
    ).status,
    200,
  );
});
test("GO-04 Flujo pendiente → en proceso → cerrada descuenta existencias una sola vez", async (t) => {
  const a = await setup(t),
    editor = await a.session("editor"),
    supervisor = await a.session("supervisor"),
    o = await a.create(editor);
  assert.equal((await a.action(supervisor, o, "close")).status, 409);
  const start = await a.action(editor, o, "start");
  assert.equal(start.status, 200);
  const close = await a.action(supervisor, start.body.operation, "close");
  assert.equal(close.status, 200);
  assert.equal(close.body.operation.status, "cerrada");
  assert.ok(close.body.operation.closed_at);
  assert.equal(close.body.operation.close_note, "Verificado por supervisión");
  assert.equal(
    a.db.prepare("SELECT quantity FROM foods WHERE id=?").get(a.food).quantity,
    7,
  );
  assert.equal(
    (await a.action(supervisor, start.body.operation, "close")).status,
    409,
  );
  assert.equal(
    a.db.prepare("SELECT quantity FROM foods WHERE id=?").get(a.food).quantity,
    7,
  );
});
test("GO-04 Al agotar existencias clasifica el alimento consumido o descartado", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  for (const [type, status] of [
    ["consumo", "consumed"],
    ["descarte", "wasted"],
  ]) {
    a.db
      .prepare("UPDATE foods SET quantity=10,status='available' WHERE id=?")
      .run(a.food);
    const o = await a.create(s, { type, quantity: 10 });
    const start = await a.action(s, o, "start");
    assert.equal(
      (await a.action(s, start.body.operation, "close")).status,
      200,
    );
    const food = a.db
      .prepare("SELECT quantity,status FROM foods WHERE id=?")
      .get(a.food);
    assert.equal(food.quantity, 0);
    assert.equal(food.status, status);
  }
});
test("GO-04 Cierre exige observación y no altera datos cuando la regla falla", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador"),
    o = await a.create(s);
  const started = (await a.action(s, o, "start")).body.operation;
  assert.equal((await a.action(s, started, "close", "x")).status, 400);
  a.db.prepare("UPDATE foods SET quantity=1 WHERE id=?").run(a.food);
  assert.equal((await a.action(s, started, "close")).status, 409);
  assert.equal(
    a.db.prepare("SELECT status,version FROM operations WHERE id=?").get(o.id)
      .status,
    "en_proceso",
  );
  assert.equal(
    a.db
      .prepare("SELECT COUNT(*) n FROM operation_history WHERE operation_id=?")
      .get(o.id).n,
    2,
  );
});
test("GO-04 Dos cierres concurrentes no pueden descontar dos veces", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador"),
    o = await a.create(s),
    started = (await a.action(s, o, "start")).body.operation;
  const r = await Promise.all([
    a.action(s, started, "close"),
    a.action(s, started, "close"),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal(
    a.db.prepare("SELECT quantity FROM foods WHERE id=?").get(a.food).quantity,
    7,
  );
  assert.equal(
    a.db
      .prepare("SELECT COUNT(*) n FROM operation_history WHERE action='closed'")
      .get().n,
    1,
  );
});
test("GO-04 Operaciones simultáneas no pueden dejar existencias negativas", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  const o1 = await a.create(s, { quantity: 7 }),
    o2 = await a.create(s, { quantity: 7 });
  const s1 = (await a.action(s, o1, "start")).body.operation,
    s2 = (await a.action(s, o2, "start")).body.operation;
  const r = await Promise.all([
    a.action(s, s1, "close"),
    a.action(s, s2, "close"),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal(
    a.db.prepare("SELECT quantity FROM foods WHERE id=?").get(a.food).quantity,
    3,
  );
});
test("GO-04 Consumo de vencidos se rechaza; descarte de vencidos sí se permite", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  a.db
    .prepare("UPDATE foods SET expires=? WHERE id=?")
    .run("2000-01-01", a.food);
  assert.equal(
    (await a.request("operations", { ...s, method: "POST", body: a.data }))
      .status,
    409,
  );
  const o = await a.create(s, { type: "descarte" }),
    started = (await a.action(s, o, "start")).body.operation;
  assert.equal((await a.action(s, started, "close")).status, 200);
});
test("GO-04 Revalida vencimiento y responsable al cerrar una operación existente", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador"),
    o = await a.create(s),
    started = (await a.action(s, o, "start")).body.operation;
  a.db
    .prepare("UPDATE foods SET expires=? WHERE id=?")
    .run("2000-01-01", a.food);
  assert.equal((await a.action(s, started, "close")).status, 409);
  a.db
    .prepare("UPDATE foods SET expires=? WHERE id=?")
    .run("2099-12-31", a.food);
  a.db.prepare("UPDATE users SET active=0 WHERE id=?").run(a.users.editor);
  assert.equal((await a.action(s, started, "close")).status, 400);
});
test("GO-04 Cancelación requiere motivo, no afecta inventario y bloquea modificaciones", async (t) => {
  const a = await setup(t),
    s = await a.session("editor"),
    o = await a.create(s);
  assert.equal((await a.action(s, o, "cancel", "x")).status, 400);
  const cancel = await a.action(s, o, "cancel", "Cambio de planificación");
  assert.equal(cancel.status, 200);
  assert.equal(
    a.db.prepare("SELECT quantity FROM foods WHERE id=?").get(a.food).quantity,
    10,
  );
  assert.equal(
    (
      await a.request("operations/" + o.id, {
        ...s,
        method: "PATCH",
        body: {
          expected_version: cancel.body.operation.version,
          title: "Otro título",
        },
      })
    ).status,
    409,
  );
  assert.equal((await a.action(s, cancel.body.operation, "start")).status, 409);
});
test("GO-05 Historial y auditoría conservan actor, transición y valores previos", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador"),
    o = await a.create(s);
  const started = (await a.action(s, o, "start")).body.operation;
  await a.action(s, started, "close");
  const history = (await a.request("operations/" + o.id, s)).body.history;
  assert.deepEqual(
    history.map((h) => h.action),
    ["created", "started", "closed"],
  );
  assert.equal(history[2].before.status, "en_proceso");
  assert.equal(history[2].after.status, "cerrada");
  assert.equal(history[2].actor_id, a.users.administrador);
  assert.ok(history[2].created_at);
  const audit = a.db
    .prepare(
      "SELECT action FROM audit WHERE action LIKE 'operation.%' ORDER BY id",
    )
    .all();
  assert.deepEqual(
    audit.map((a) => a.action),
    ["operation.created", "operation.started", "operation.closed"],
  );
  assert.equal(
    (
      await a.request("operations/" + o.id + "/history", {
        ...s,
        method: "DELETE",
        body: {},
      })
    ).status,
    404,
  );
});
test("GO-06 Reportes CSV e impresión respetan filtros y neutralizan contenido de usuario", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  await a.create(s, {
    title: '=HYPERLINK("malicioso")',
    notes: "<script>alert(1)</script>",
  });
  await a.create(s, { scheduled_date: "2099-11-01" });
  const csv = await a.request("operations/export.csv?from=2099-12-01", s);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /attachment/);
  assert.ok(csv.body.includes('"Total","1"'));
  assert.ok(csv.body.includes("\"'=HYPERLINK"));
  const print = await a.request("operations/print?status=cerrada", s);
  assert.equal(print.status, 200);
  assert.ok(print.body.includes("No hay operaciones"));
  const html = await a.request("operations/print", s);
  assert.ok(html.body.includes("&quot;malicioso&quot;"));
  assert.ok(!html.body.includes("<script>alert(1)</script>"));
  assert.equal(
    a.db
      .prepare("SELECT COUNT(*) n FROM audit WHERE action='operation.report'")
      .get().n,
    3,
  );
});
test("GO-06 Reporte no limita a 100 registros y el filtro vacío es válido", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador");
  for (let i = 0; i < 105; i++) await a.create(s, { title: "Operación " + i });
  const csv = await a.request("operations/export.csv", s);
  assert.ok(csv.body.includes('"Total","105"'));
  assert.ok(csv.body.includes("Operación 104"));
  assert.equal(
    (await a.request("operations?status=&from=&to=&responsible_id=", s)).body
      .operations.length,
    105,
  );
});
test("GO-07 Matriz de permisos de lectura, gestión, cierre y reporte", async (t) => {
  const a = await setup(t),
    admin = await a.session("administrador"),
    o = await a.create(admin);
  for (const [role, read, manage, close, report] of [
    ["lector", 403, 403, 403, 403],
    ["editor", 200, 201, 403, 403],
    ["supervisor", 200, 403, 409, 200],
    ["administrador", 200, 201, 409, 200],
  ]) {
    const s = await a.session(role);
    assert.equal(
      (await a.request("operations", s)).status,
      read,
      role + " read",
    );
    assert.equal(
      (await a.request("operations", { ...s, method: "POST", body: a.data }))
        .status,
      manage,
      role + " manage",
    );
    assert.equal(
      (await a.action(s, o, "close")).status,
      close,
      role + " close",
    );
    assert.equal(
      (await a.request("operations/export.csv", s)).status,
      report,
      role + " report",
    );
  }
  for (const route of [
    "operations",
    "operations/options",
    "operations/" + o.id,
    "operations/export.csv",
    "operations/print",
  ])
    assert.equal((await a.request(route)).status, 401);
});
test("GO-07 CSRF, versión, estado y recursos inválidos no permiten mutaciones", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador"),
    o = await a.create(s);
  assert.equal(
    (
      await a.request("operations", {
        cookie: s.cookie,
        method: "POST",
        body: a.data,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await a.request("operations/" + o.id, {
        ...s,
        method: "PATCH",
        body: { title: "Título" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await a.request("operations/" + o.id, {
        ...s,
        method: "PATCH",
        body: { expected_version: 1, status: "cerrada" },
      })
    ).status,
    400,
  );
  assert.equal((await a.request("operations/999", s)).status, 404);
  assert.equal(
    (await a.action(s, { id: 999, version: 1 }, "start")).status,
    404,
  );
});
test("GO-08 Migración preserva datos y permisos existentes y solo se aplica una vez", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "foodsave-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "legacy.sqlite");
  const old = new DatabaseSync(path);
  old.exec(
    "CREATE TABLE roles(id TEXT PRIMARY KEY,permissions TEXT NOT NULL); CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id INTEGER,csrf TEXT,expires INTEGER);",
  );
  old
    .prepare("INSERT INTO roles VALUES (?,?)")
    .run("editor", JSON.stringify(["inventory.read"]));
  old
    .prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
    .run("Usuario existente", "old@example.test", hash, "editor");
  old.close();
  const db = openStore(path);
  assert.equal(
    db.prepare("SELECT name FROM users").get().name,
    "Usuario existente",
  );
  let perms = JSON.parse(
    db.prepare("SELECT permissions FROM roles WHERE id='editor'").get()
      .permissions,
  );
  assert.ok(perms.includes("operations.manage"));
  assert.ok(!perms.includes("inventory.manage"));
  db.prepare("UPDATE roles SET permissions='[]' WHERE id='editor'").run();
  db.close();
  const reopened = openStore(path);
  assert.equal(
    reopened.prepare("SELECT permissions FROM roles WHERE id='editor'").get()
      .permissions,
    "[]",
  );
  assert.equal(
    reopened.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
    1,
  );
  reopened.close();
});

test("GO-01 No se programa consumo para una fecha posterior al vencimiento", async (t) => {
  const a = await setup(t),
    s = await a.session("editor");
  a.db
    .prepare("UPDATE foods SET expires=? WHERE id=?")
    .run("2099-11-30", a.food);
  assert.equal(
    (await a.request("operations", { ...s, method: "POST", body: a.data }))
      .status,
    409,
  );
  assert.equal(
    (
      await a.request("operations", {
        ...s,
        method: "POST",
        body: { ...a.data, type: "descarte" },
      })
    ).status,
    201,
  );
});
test("GO-04 Un cierre definitivo no admite cambios y conserva su historial", async (t) => {
  const a = await setup(t),
    s = await a.session("administrador"),
    o = await a.create(s),
    started = (await a.action(s, o, "start")).body.operation,
    closed = (await a.action(s, started, "close")).body.operation;
  for (const action of ["start", "close", "cancel"])
    assert.equal((await a.action(s, closed, action)).status, 409);
  assert.equal(
    (
      await a.request("operations/" + o.id, {
        ...s,
        method: "PATCH",
        body: { expected_version: closed.version, title: "Intento de cambio" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await a.request("operations/" + o.id, s)).body.history.length,
    3,
  );
});
