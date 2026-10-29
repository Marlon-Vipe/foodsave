import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  openStore,
  permissions,
  hashPassword,
  verifyPassword,
  publicUser,
  digest,
} from "./store.mjs";
export async function createApp({
  database = "app.sqlite",
  origin = "http://localhost:3000",
  secure = false,
} = {}) {
  const db = openStore(database),
    dummy = await hashPassword(randomBytes(32).toString("hex"));
  const audit = (actor, action, target, ip) =>
    db
      .prepare("INSERT INTO audit(actor_id,action,target,ip) VALUES (?,?,?,?)")
      .run(actor ?? null, action, String(target ?? ""), ip);
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress,
      url = new URL(req.url, origin),
      path = url.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (!path.startsWith("/api/")) {
        if (req.method !== "GET") fail(405, "Método no permitido");
        const files = {
          "/": "index.html",
          "/app.js": "app.js",
          "/style.css": "style.css",
        };
        if (/^\/assets\/[a-f0-9]+\.svg$/.test(path))
          files[path] = path.slice(1);
        if (!files[path]) fail(404, "Página no encontrada");
        const content = await readFile(
          new URL("./public/" + files[path], import.meta.url),
        );
        res.setHeader(
          "Content-Type",
          path.endsWith(".svg")
            ? "image/svg+xml"
            : path.endsWith(".js")
              ? "text/javascript"
              : path.endsWith(".css")
                ? "text/css"
                : "text/html; charset=utf-8",
        );
        res.end(content);
        return;
      }
      let body = {};
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        if (req.headers.origin !== origin) fail(403, "Origen no autorizado");
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          fail(415, "Se requiere JSON");
        let raw = "";
        for await (const part of req) {
          raw += part;
          if (Buffer.byteLength(raw) > 16384)
            fail(413, "Solicitud demasiado grande");
        }
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          fail(400, "JSON inválido");
        }
        if (!body || Array.isArray(body) || typeof body !== "object")
          fail(400, "Solicitud inválida");
      }
      const cookie = String(req.headers.cookie ?? "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("session="))
        ?.slice(8);
      const session = cookie
        ? db
            .prepare(
              "SELECT s.*,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
            )
            .get(digest(cookie), Date.now())
        : null;
      const user = session?.active
        ? db.prepare("SELECT * FROM users WHERE id=?").get(session.user_id)
        : null;
      const granted = user
        ? JSON.parse(
            db
              .prepare("SELECT permissions FROM roles WHERE id=?")
              .get(user.role).permissions,
          )
        : [];
      const requirePermission = (p) => {
        if (!user) fail(401, "Inicia sesión para continuar");
        if (!granted.includes(p)) {
          audit(user.id, "access.denied", p, ip);
          fail(403, "No tienes permiso para esta funcionalidad");
        }
      };
      const rateLimit = (key) => {
        const now = Date.now(),
          row = db.prepare("SELECT * FROM attempts WHERE key=?").get(key);
        if (row && row.reset_at > now && row.count >= 8)
          fail(429, "Demasiados intentos. Intenta dentro de 15 minutos");
        db.prepare(
          "INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END",
        ).run(key, now + 900000, now, now);
      };
      if (
        req.method === "POST" &&
        ["/api/register", "/api/login"].includes(path)
      ) {
        if (typeof body.email !== "string" || typeof body.password !== "string")
          fail(400, "Correo y contraseña son obligatorios");
        const email = body.email.trim().toLowerCase(),
          password = body.password;
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 254 ||
          password.length > 128
        )
          fail(400, "Credenciales inválidas");
        rateLimit("ip:" + ip);
        rateLimit("email:" + email);
        if (path === "/api/register") {
          if (
            typeof body.name !== "string" ||
            body.name.trim().length < 2 ||
            body.name.length > 100 ||
            password.length < 12
          )
            fail(
              400,
              "Nombre: 2–100 caracteres. Contraseña: 12–128 caracteres",
            );
          const hash = await hashPassword(password);
          let id;
          try {
            id = transaction(() => {
              const result = db
                .prepare(
                  "INSERT INTO users(name,email,password,role) VALUES (?,?,?,'lector')",
                )
                .run(body.name.trim(), email, hash);
              audit(
                Number(result.lastInsertRowid),
                "user.registered",
                result.lastInsertRowid,
                ip,
              );
              return Number(result.lastInsertRowid);
            });
          } catch (e) {
            if (
              e.code?.startsWith("ERR_SQLITE") &&
              String(e.message).includes("UNIQUE")
            )
              fail(409, "No se pudo registrar este correo");
            throw e;
          }
          json(201, {
            user: publicUser(
              db.prepare("SELECT * FROM users WHERE id=?").get(id),
            ),
          });
          return;
        }
        let candidate = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(email);
        const valid = await verifyPassword(
          password,
          candidate?.password ?? dummy,
        );
        candidate = candidate
          ? db.prepare("SELECT * FROM users WHERE id=?").get(candidate.id)
          : null;
        if (!candidate || !valid || !candidate.active) {
          audit(null, "login.failed", email, ip);
          fail(401, "Correo o contraseña incorrectos");
        }
        const token = randomBytes(32).toString("hex"),
          csrf = randomBytes(32).toString("hex");
        transaction(() => {
          db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(
            digest(token),
            candidate.id,
            csrf,
            Date.now() + 8 * 3600000,
          );
          audit(candidate.id, "login.succeeded", candidate.id, ip);
        });
        res.setHeader(
          "Set-Cookie",
          `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? "; Secure" : ""}`,
        );
        json(200, {
          user: publicUser(candidate),
          csrf,
          permissions: JSON.parse(
            db
              .prepare("SELECT permissions FROM roles WHERE id=?")
              .get(candidate.role).permissions,
          ),
        });
        return;
      }
      if (!user) fail(401, "Inicia sesión para continuar");
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers["x-csrf-token"] !== session.csrf
      )
        fail(403, "Token de seguridad inválido");
      if (path === "/api/me" && req.method === "GET") {
        json(200, {
          user: publicUser(user),
          csrf: session.csrf,
          permissions: granted,
        });
        return;
      }
      if (path === "/api/logout" && req.method === "POST") {
        transaction(() => {
          db.prepare("DELETE FROM sessions WHERE token=?").run(session.token);
          audit(user.id, "logout", user.id, ip);
        });
        res.setHeader(
          "Set-Cookie",
          "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        json(200, { ok: true });
        return;
      }
      if (path === "/api/users" && req.method === "GET") {
        requirePermission("users.read");
        json(200, {
          users: db
            .prepare(
              "SELECT id,name,email,role,active,created_at FROM users ORDER BY id DESC",
            )
            .all(),
        });
        return;
      }
      if (/^\/api\/users\/\d+$/.test(path) && req.method === "PATCH") {
        requirePermission("users.manage");
        const id = Number(path.split("/").pop()),
          target = db.prepare("SELECT * FROM users WHERE id=?").get(id);
        if (!target) fail(404, "Usuario no encontrado");
        if (
          Object.keys(body).some((k) => !["role", "active"].includes(k)) ||
          !Object.keys(body).length
        )
          fail(400, "Solo se admiten rol y estado");
        if (body.role !== undefined && typeof body.role !== "string")
          fail(400, "Rol inválido");
        if (
          body.role !== undefined &&
          !db.prepare("SELECT id FROM roles WHERE id=?").get(body.role)
        )
          fail(400, "Rol inválido");
        if (body.active !== undefined && typeof body.active !== "boolean")
          fail(400, "Estado inválido");
        const role = body.role ?? target.role,
          active =
            body.active === undefined ? target.active : Number(body.active);
        if (id === user.id && (role !== user.role || !active))
          fail(409, "No puedes retirar tu propio acceso administrativo");
        if (
          target.role === "administrador" &&
          target.active &&
          (role !== "administrador" || !active) &&
          db
            .prepare(
              "SELECT COUNT(*) n FROM users WHERE role='administrador' AND active=1",
            )
            .get().n <= 1
        )
          fail(409, "Debe existir un administrador activo");
        transaction(() => {
          db.prepare("UPDATE users SET role=?,active=? WHERE id=?").run(
            role,
            active,
            id,
          );
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
          audit(
            user.id,
            "user.updated",
            JSON.stringify({ id, role, active }),
            ip,
          );
        });
        json(200, { ok: true });
        return;
      }
      if (path === "/api/roles" && req.method === "GET") {
        requirePermission("roles.manage");
        json(200, {
          roles: db
            .prepare("SELECT * FROM roles")
            .all()
            .map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })),
          permissions,
        });
        return;
      }
      if (path.startsWith("/api/roles/") && req.method === "PUT") {
        requirePermission("roles.manage");
        const id = path.split("/").pop();
        if (id === "administrador")
          fail(409, "El rol administrador conserva todos los permisos");
        if (!db.prepare("SELECT id FROM roles WHERE id=?").get(id))
          fail(404, "Rol no encontrado");
        if (
          !Array.isArray(body.permissions) ||
          body.permissions.some((p) => !permissions.includes(p))
        )
          fail(400, "Permisos inválidos");
        if (
          body.permissions.some((p) =>
            ["users.manage", "roles.manage"].includes(p),
          )
        )
          fail(
            400,
            "La administración de seguridad está reservada al administrador",
          );
        transaction(() => {
          db.prepare("UPDATE roles SET permissions=? WHERE id=?").run(
            JSON.stringify([...new Set(body.permissions)]),
            id,
          );
          db.prepare(
            "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)",
          ).run(id);
          audit(
            user.id,
            "role.updated",
            JSON.stringify({ id, permissions: body.permissions }),
            ip,
          );
        });
        json(200, { ok: true });
        return;
      }
      if (path === "/api/audit" && req.method === "GET") {
        requirePermission("audit.read");
        json(200, {
          events: db
            .prepare(
              "SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.id DESC LIMIT 200",
            )
            .all(),
        });
        return;
      }
      if (path === "/api/inventory" && req.method === "GET") {
        requirePermission("inventory.read");
        json(200, {
          foods: db
            .prepare(
              "SELECT * FROM foods WHERE status='available' ORDER BY expires,id",
            )
            .all(),
        });
        return;
      }
      if (path === "/api/inventory" && req.method === "POST") {
        requirePermission("inventory.manage");
        if (
          typeof body.name !== "string" ||
          body.name.trim().length < 2 ||
          body.name.length > 100 ||
          ![
            "Lácteos",
            "Carnes",
            "Frutas y verduras",
            "Panadería",
            "Congelados",
            "Otros",
          ].includes(body.category) ||
          !Number.isInteger(body.quantity) ||
          body.quantity < 1 ||
          body.quantity > 10000 ||
          typeof body.expires !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.expires) ||
          !Number.isFinite(Date.parse(body.expires)) ||
          new Date(body.expires).toISOString().slice(0, 10) !== body.expires
        )
          fail(400, "Revisa nombre, categoría, cantidad y fecha");
        const id = transaction(() => {
          const r = db
            .prepare(
              "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
            )
            .run(
              body.name.trim(),
              body.category,
              body.quantity,
              body.expires,
              user.id,
            );
          audit(user.id, "food.created", r.lastInsertRowid, ip);
          return Number(r.lastInsertRowid);
        });
        json(201, { id });
        return;
      }
      if (/^\/api\/inventory\/\d+$/.test(path) && req.method === "PATCH") {
        requirePermission("inventory.manage");
        const id = Number(path.split("/").pop());
        if (!["consumed", "wasted"].includes(body.status))
          fail(400, "Estado inválido");
        transaction(() => {
          const r = db
            .prepare(
              "UPDATE foods SET status=? WHERE id=? AND status='available'",
            )
            .run(body.status, id);
          if (!r.changes) fail(404, "Alimento no disponible");
          audit(user.id, "food." + body.status, id, ip);
        });
        json(200, { ok: true });
        return;
      }
      if (path === "/api/reports" && req.method === "GET") {
        requirePermission("reports.read");
        json(200, {
          summary: db
            .prepare("SELECT status,COUNT(*) count FROM foods GROUP BY status")
            .all(),
          history: db
            .prepare(
              "SELECT id,name,category,status,expires FROM foods WHERE status!='available' ORDER BY id DESC LIMIT 100",
            )
            .all(),
        });
        return;
      }
      fail(404, "Recurso no encontrado");
    } catch (error) {
      if (!error.status) console.error(error);
      json(error.status ?? 500, {
        error: error.status ? error.message : "Error interno del servidor",
      });
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000),
    origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
  const { server } = await createApp({
    database: process.env.DATABASE_PATH ?? "app.sqlite",
    origin,
    secure: origin.startsWith("https://"),
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Aplicación disponible en ${origin}`),
  );
}
