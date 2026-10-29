import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.mjs";
import { hashPassword, verifyPassword } from "../store.mjs";
const password = "Prueba-segura-2026!";
async function setup(t) {
  const app = await createApp({
    database: ":memory:",
    origin: "http://localhost:3000",
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.close();
    app.db.close();
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (
    path,
    {
      method = "GET",
      body,
      cookie,
      csrf,
      origin = "http://localhost:3000",
    } = {},
  ) => {
    const r = await fetch(url + "/api/" + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const account = async (role = "lector") => {
    const email = `${role}-${Math.random()}@example.test`;
    const id = app.db
      .prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
      .run(
        "Prueba " + role,
        email,
        await hashPassword(password),
        role,
      ).lastInsertRowid;
    return { id: Number(id), email };
  };
  const login = async (a) => {
    app.db.prepare("DELETE FROM attempts").run();
    const r = await request("login", {
      method: "POST",
      body: { email: a.email, password },
    });
    assert.equal(r.status, 200);
    return { cookie: r.cookie, csrf: r.body.csrf };
  };
  return { ...app, request, account, login };
}
test("HU-01 Registro persiste lector, normaliza correo y nunca expone hash", async (t) => {
  const a = await setup(t);
  const r = await a.request("register", {
    method: "POST",
    body: {
      name: "María Pérez",
      email: " MARIA@Example.test ",
      password,
      role: "administrador",
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, "lector");
  assert.equal(r.body.user.email, "maria@example.test");
  assert.ok(!("password" in r.body.user));
  const u = a.db.prepare("SELECT * FROM users").get();
  assert.notEqual(u.password, password);
  assert.ok(await verifyPassword(password, u.password));
});
test("HU-01 Rechaza contraseñas cortas, nombre vacío y correo inválido", async (t) => {
  const a = await setup(t);
  for (const body of [
    { name: "X", email: "bad", password },
    { name: "María", email: "m@example.test", password: "123" },
    { name: "", email: "m@example.test", password },
  ])
    assert.equal(
      (await a.request("register", { method: "POST", body })).status,
      400,
    );
});
test("HU-01 Rechaza correos duplicados sin crear otra cuenta", async (t) => {
  const a = await setup(t);
  const body = { name: "María", email: "m@example.test", password };
  assert.equal(
    (await a.request("register", { method: "POST", body })).status,
    201,
  );
  assert.equal(
    (await a.request("register", { method: "POST", body })).status,
    409,
  );
  assert.equal(a.db.prepare("SELECT count(*) n FROM users").get().n, 1);
});
test("HU-02 Login correcto, sesión persistida como hash y perfil disponible", async (t) => {
  const a = await setup(t),
    u = await a.account(),
    s = await a.login(u);
  const r = await a.request("me", s);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, u.id);
  assert.ok(!("password" in r.body.user));
  assert.notEqual(
    a.db.prepare("SELECT token FROM sessions").get().token,
    s.cookie.slice(8),
  );
});
test("HU-02 Credenciales incorrectas no autentican y quedan auditadas", async (t) => {
  const a = await setup(t),
    u = await a.account();
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: u.email, password: "incorrecta" },
      })
    ).status,
    401,
  );
  assert.equal(
    a.db
      .prepare("SELECT count(*) n FROM audit WHERE action='login.failed'")
      .get().n,
    1,
  );
});
test("HU-02 Limita intentos repetidos", async (t) => {
  const a = await setup(t);
  for (let i = 0; i < 8; i++)
    assert.equal(
      (
        await a.request("login", {
          method: "POST",
          body: { email: "x@example.test", password },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: "x@example.test", password },
      })
    ).status,
    429,
  );
});
test("HU-03 Logout revoca la sesión y el token antiguo recibe 401", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account());
  assert.equal(
    (await a.request("logout", { ...s, method: "POST", body: {} })).status,
    200,
  );
  assert.equal((await a.request("me", s)).status, 401);
});
test("HU-04 Administrador lista usuarios sin hashes", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account("administrador"));
  const r = await a.request("users", s);
  assert.equal(r.status, 200);
  assert.ok(r.body.users.every((u) => !("password" in u)));
});
test("HU-04 Cambio de rol revoca sesiones y aplica nuevos permisos", async (t) => {
  const a = await setup(t),
    u = await a.account(),
    s = await a.login(u),
    admin = await a.login(await a.account("administrador"));
  assert.equal(
    (
      await a.request("users/" + u.id, {
        ...admin,
        method: "PATCH",
        body: { role: "supervisor" },
      })
    ).status,
    200,
  );
  assert.equal((await a.request("me", s)).status, 401);
  const updated = await a.login(u);
  assert.equal((await a.request("reports", updated)).status, 200);
});
test("HU-04 Desactivación bloquea sesión y login; reactivación permite entrar", async (t) => {
  const a = await setup(t),
    u = await a.account(),
    s = await a.login(u),
    admin = await a.login(await a.account("administrador"));
  assert.equal(
    (
      await a.request("users/" + u.id, {
        ...admin,
        method: "PATCH",
        body: { active: false },
      })
    ).status,
    200,
  );
  assert.equal((await a.request("me", s)).status, 401);
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: u.email, password },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await a.request("users/" + u.id, {
        ...admin,
        method: "PATCH",
        body: { active: true },
      })
    ).status,
    200,
  );
  await a.login(u);
});
test("HU-04 Impide retirar el acceso del propio administrador", async (t) => {
  const a = await setup(t),
    u = await a.account("administrador"),
    s = await a.login(u);
  assert.equal(
    (
      await a.request("users/" + u.id, {
        ...s,
        method: "PATCH",
        body: { role: "lector" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await a.request("users/" + u.id, {
        ...s,
        method: "PATCH",
        body: { active: false },
      })
    ).status,
    409,
  );
});
test("HU-05 Modifica permisos y revoca sesiones del perfil", async (t) => {
  const a = await setup(t),
    u = await a.account("supervisor"),
    s = await a.login(u),
    admin = await a.login(await a.account("administrador"));
  assert.equal(
    (
      await a.request("roles/supervisor", {
        ...admin,
        method: "PUT",
        body: { permissions: ["inventory.read"] },
      })
    ).status,
    200,
  );
  assert.equal((await a.request("me", s)).status, 401);
  const updated = await a.login(u);
  assert.equal((await a.request("reports", updated)).status, 403);
});
test("HU-05 Protege permisos administrativos y valida códigos", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account("administrador"));
  for (const [role, permissions, status] of [
    ["administrador", [], 409],
    ["lector", ["roles.manage"], 400],
    ["editor", ["inventado"], 400],
  ])
    assert.equal(
      (
        await a.request("roles/" + role, {
          ...s,
          method: "PUT",
          body: { permissions },
        })
      ).status,
      status,
    );
});
test("HU-06 Matriz de accesos por perfil se valida en servidor", async (t) => {
  const a = await setup(t);
  for (const [role, statuses] of [
    ["lector", [200, 403, 403, 403, 403]],
    ["editor", [200, 403, 403, 403, 403]],
    ["supervisor", [200, 200, 403, 403, 403]],
    ["administrador", [200, 200, 200, 200, 200]],
  ]) {
    const s = await a.login(await a.account(role));
    for (const [i, path] of [
      "inventory",
      "reports",
      "users",
      "roles",
      "audit",
    ].entries())
      assert.equal(
        (await a.request(path, s)).status,
        statuses[i],
        role + " " + path,
      );
  }
});
test("HU-06 Anónimo no accede a ningún módulo protegido", async (t) => {
  const a = await setup(t);
  for (const p of ["me", "users", "roles", "audit", "inventory", "reports"])
    assert.equal((await a.request(p)).status, 401);
});
test("HU-06 Lector no puede modificar usuarios ni permisos", async (t) => {
  const a = await setup(t),
    u = await a.account(),
    s = await a.login(u);
  assert.equal(
    (
      await a.request("users/" + u.id, {
        ...s,
        method: "PATCH",
        body: { role: "administrador" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await a.request("roles/lector", {
        ...s,
        method: "PUT",
        body: { permissions: ["roles.manage"] },
      })
    ).status,
    403,
  );
});
test("HU-07 Auditoría guarda actor, acción, objetivo y fecha", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account("administrador"));
  const r = await a.request("audit", s);
  assert.equal(r.status, 200);
  const e = r.body.events[0];
  assert.equal(e.action, "login.succeeded");
  assert.ok(e.actor_id && e.created_at && e.target);
  assert.ok(!JSON.stringify(r.body).includes(password));
});
test("Seguridad: CSRF y origen externo rechazados", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account());
  assert.equal(
    (await a.request("logout", { cookie: s.cookie, method: "POST", body: {} }))
      .status,
    403,
  );
  assert.equal(
    (
      await a.request("logout", {
        ...s,
        method: "POST",
        body: {},
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await a.request("me", s)).status, 200);
});
test("Seguridad: sesión expirada rechazada", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account());
  a.db.prepare("UPDATE sessions SET expires=0").run();
  assert.equal((await a.request("me", s)).status, 401);
});
test("Seguridad: parámetros SQL no permiten saltar autenticación", async (t) => {
  const a = await setup(t);
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: "x'OR(1=1)--@example.test", password },
      })
    ).status,
    401,
  );
});
test("HU-06 Inventario: lector consulta; editor crea y procesa alimentos; supervisor ve reportes", async (t) => {
  const a = await setup(t),
    reader = await a.login(await a.account()),
    editor = await a.login(await a.account("editor")),
    supervisor = await a.login(await a.account("supervisor"));
  const body = {
    name: "Leche entera",
    category: "Lácteos",
    quantity: 2,
    expires: "2026-11-03",
  };
  assert.equal(
    (await a.request("inventory", { ...reader, method: "POST", body })).status,
    403,
  );
  const created = await a.request("inventory", {
    ...editor,
    method: "POST",
    body,
  });
  assert.equal(created.status, 201);
  const inventory = await a.request("inventory", reader);
  assert.equal(inventory.body.foods[0].name, body.name);
  assert.equal(
    (
      await a.request("inventory/" + created.body.id, {
        ...editor,
        method: "PATCH",
        body: { status: "consumed" },
      })
    ).status,
    200,
  );
  const report = await a.request("reports", supervisor);
  assert.equal(report.body.summary[0].status, "consumed");
  assert.equal(report.body.summary[0].count, 1);
});
test("Inventario rechaza fechas inexistentes, cantidades y categorías inválidas", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account("editor"));
  const body = {
    name: "Pan",
    category: "Panadería",
    quantity: 1,
    expires: "2026-11-03",
  };
  for (const change of [
    { expires: "2026-02-30" },
    { quantity: 0 },
    { quantity: 1.5 },
    { category: "Inválida" },
  ])
    assert.equal(
      (
        await a.request("inventory", {
          ...s,
          method: "POST",
          body: { ...body, ...change },
        })
      ).status,
      400,
    );
});
test("Cookie HttpOnly y SameSite, recursos locales y cabeceras de seguridad", async (t) => {
  const a = await setup(t),
    u = await a.account();
  const url = `http://127.0.0.1:${a.server.address().port}`;
  const r = await fetch(url + "/api/login", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: u.email, password }),
  });
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Strict/);
  assert.match(
    r.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  for (const path of ["/", "/style.css", "/app.js", "/assets/2f46b.svg"])
    assert.equal((await fetch(url + path)).status, 200);
  assert.equal((await fetch(url + "/server.mjs")).status, 404);
});
test("Datos de usuario malformados reciben 400 y no afectan permisos", async (t) => {
  const a = await setup(t),
    u = await a.account(),
    s = await a.login(await a.account("administrador"));
  for (const body of [{ role: {} }, { active: "false" }, { password: "x" }, {}])
    assert.equal(
      (await a.request("users/" + u.id, { ...s, method: "PATCH", body }))
        .status,
      400,
    );
  assert.equal(
    a.db.prepare("SELECT role FROM users WHERE id=?").get(u.id).role,
    "lector",
  );
});

test("Regresión: veinte logins correctos no bloquean el entorno compartido", async (t) => {
  const a = await setup(t),
    u = await a.account("administrador");
  for (let i = 0; i < 20; i++) {
    const r = await a.request("login", {
      method: "POST",
      body: { email: u.email, password },
    });
    assert.equal(r.status, 200);
  }
  assert.ok(
    a.db
      .prepare("SELECT count FROM attempts")
      .all()
      .every((r) => r.count === 0),
  );
});
test("Regresión: un login correcto no borra fallos previos y el noveno intento se bloquea", async (t) => {
  const a = await setup(t),
    u = await a.account();
  for (let i = 0; i < 7; i++)
    assert.equal(
      (
        await a.request("login", {
          method: "POST",
          body: { email: u.email, password: "incorrecta" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: u.email, password },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: u.email, password: "incorrecta" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: u.email, password },
      })
    ).status,
    429,
  );
});
test("Regresión: el límite de registro no bloquea el inicio de sesión", async (t) => {
  const a = await setup(t),
    u = await a.account("administrador");
  for (let i = 0; i < 8; i++)
    await a.request("register", {
      method: "POST",
      body: {
        name: "Nuevo usuario",
        email: "new" + i + "@example.test",
        password,
      },
    });
  assert.equal(
    (
      await a.request("register", {
        method: "POST",
        body: { name: "Otro usuario", email: "other@example.test", password },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await a.request("login", {
        method: "POST",
        body: { email: u.email, password },
      })
    ).status,
    200,
  );
});

test("Reportes: exportación y vista imprimible rechazan anónimos y perfiles sin permiso", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account("lector"));
  for (const route of ["reports/export.csv", "reports/print"]) {
    assert.equal((await a.request(route)).status, 401);
    assert.equal((await a.request(route, s)).status, 403);
  }
});
test("Reportes: CSV incluye inventario e historial completos, resumen y auditoría", async (t) => {
  const a = await setup(t),
    u = await a.account("supervisor"),
    s = await a.login(u);
  const insert = a.db.prepare(
    "INSERT INTO foods(name,category,quantity,expires,status,created_by) VALUES (?,?,?,?,?,?)",
  );
  for (let i = 0; i < 105; i++)
    insert.run(
      "Alimento " + i,
      "Otros",
      2,
      "2026-12-01",
      i === 0 ? "available" : i === 1 ? "wasted" : "consumed",
      u.id,
    );
  const r = await fetch(
    `http://127.0.0.1:${a.server.address().port}/api/reports/export.csv`,
    { headers: { Cookie: s.cookie } },
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/csv/);
  assert.match(
    r.headers.get("content-disposition"),
    /attachment; filename="foodsave-reporte-/,
  );
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const csv = bytes.toString("utf8");
  assert.ok(csv.includes('"Total de alimentos","105"'));
  assert.ok(csv.includes("Alimento 104"));
  assert.ok(csv.includes('"Aprovechados","103"'));
  assert.ok(csv.includes('"Descartados","1"'));
  assert.equal(
    a.db
      .prepare("SELECT count(*) n FROM audit WHERE action='report.generated'")
      .get().n,
    1,
  );
});
test("Reportes: neutraliza fórmulas CSV y escapa HTML de datos ingresados", async (t) => {
  const a = await setup(t),
    u = await a.account("administrador"),
    s = await a.login(u);
  a.db
    .prepare(
      "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
    )
    .run('=HYPERLINK("https://example.test")', "Otros", 1, "2026-12-01", u.id);
  a.db
    .prepare(
      "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
    )
    .run("<script>alert(1)</script>", "Otros", 1, "2026-12-01", u.id);
  const base = `http://127.0.0.1:${a.server.address().port}/api/reports/`;
  const csv = await (
    await fetch(base + "export.csv", { headers: { Cookie: s.cookie } })
  ).text();
  assert.ok(csv.includes("\"'=HYPERLINK"));
  const print = await fetch(base + "print", { headers: { Cookie: s.cookie } });
  assert.equal(print.status, 200);
  const html = await print.text();
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("/report.js"));
  assert.ok(html.includes("Preparado por:"));
});
test("Reportes: base vacía produce un reporte válido con totales cero", async (t) => {
  const a = await setup(t),
    s = await a.login(await a.account("supervisor"));
  const r = await fetch(
    `http://127.0.0.1:${a.server.address().port}/api/reports/print`,
    { headers: { Cookie: s.cookie } },
  );
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes("No hay alimentos registrados."));
  assert.ok(html.includes("0%"));
});
