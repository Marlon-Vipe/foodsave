import { initializeLogisticsDashboard, handleLogisticsDashboard } from "./logistics-dashboard.mjs";
export const logisticsPermissions = ["logistics.read", "logistics.move", "logistics.report"];
export const logisticsDefaults = {
  administrador: logisticsPermissions,
  editor: ["logistics.read", "logistics.move"],
  supervisor: ["logistics.read", "logistics.report"],
};
export const foodCategories = ["Lácteos", "Carnes", "Frutas y verduras", "Panadería", "Congelados", "Otros"];
export const stockLimit = 10000;
const types = { opening: "Saldo inicial", entry: "Entrada", exit: "Salida" };
const sources = { migration: "Saldo de apertura", inventory: "Inventario", logistics: "Logística", operation: "Operación" };

export function initializeLogistics(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_movements(
        id INTEGER PRIMARY KEY,
        food_id INTEGER NOT NULL REFERENCES foods(id),
        type TEXT NOT NULL CHECK(type IN ('opening','entry','exit')),
        source TEXT NOT NULL CHECK(source IN ('migration','inventory','logistics','operation')),
        quantity INTEGER NOT NULL CHECK(quantity>0),
        before_qty INTEGER NOT NULL CHECK(before_qty>=0),
        after_qty INTEGER NOT NULL CHECK(after_qty>=0),
        reason TEXT NOT NULL,
        actor_id INTEGER REFERENCES users(id),
        operation_id INTEGER UNIQUE REFERENCES operations(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK((type='exit' AND after_qty=before_qty-quantity)
           OR (type IN ('opening','entry') AND after_qty=before_qty+quantity))
      );
      CREATE INDEX IF NOT EXISTS stock_movements_food ON stock_movements(food_id,id);
    `);
    if (db.prepare("INSERT OR IGNORE INTO schema_migrations(id) VALUES ('logistics-v1')").run().changes) {
      db.exec(`INSERT INTO stock_movements(food_id,type,source,quantity,before_qty,after_qty,reason)
        SELECT id,'opening','migration',quantity,0,quantity,'Existencias al activar el historial'
        FROM foods WHERE status='available' AND quantity>0`);
      for (const [role, grants] of Object.entries(logisticsDefaults)) {
        const record = db.prepare("SELECT permissions FROM roles WHERE id=?").get(role);
        if (!record) continue;
        const previous = JSON.parse(record.permissions);
        if (grants.every((p) => previous.includes(p))) continue;
        db.prepare("UPDATE roles SET permissions=? WHERE id=?").run(
          JSON.stringify([...new Set([...previous, ...grants])]), role,
        );
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)").run(role);
      }
    }
    initializeLogisticsDashboard(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// All callers write inside the same transaction as the corresponding stock change.
export function recordMovement(db, { foodId, type, source, before, after, reason, actor, operationId = null }) {
  const insert = db.prepare(`INSERT INTO stock_movements(food_id,type,source,quantity,before_qty,after_qty,reason,actor_id,operation_id)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  // Covers demo/imported stock added outside the application after migration.
  if (before > 0 && !db.prepare("SELECT 1 FROM stock_movements WHERE food_id=? LIMIT 1").get(foodId))
    insert.run(foodId, "opening", "migration", before, 0, before, "Saldo antes del primer movimiento registrado", null, null);
  return Number(insert.run(foodId, type, source, Math.abs(after - before), before, after, reason, actor, operationId).lastInsertRowid);
}

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
const idValid = (n) => Number.isSafeInteger(n) && n > 0;
const dateValid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
  && new Date(v).toISOString().slice(0, 10) === v;
const csv = (rows) => "\uFEFF" + rows.map((row) => row.map((value) => {
  let s = String(value ?? "");
  if (/^\s*[=+\-@]|^[\t\r\n]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}).join(",")).join("\r\n") + "\r\n";

export function handleLogistics(context) {
  const { req, res, path, url, db, user, body, requirePermission, audit, transaction, json, fail } = context;
  if (handleLogisticsDashboard(context)) return true;
  if (!path.startsWith("/api/logistics/")) return false;
  const ip = req.socket.remoteAddress;
  const date = today();
  const exportType = ({
    "/api/logistics/stock.csv": "stock",
    "/api/logistics/movements.csv": "movements",
  })[path];
  const stockPath = path === "/api/logistics/stock";
  const movementPath = path === "/api/logistics/movements";
  if (movementPath && req.method === "POST") {
    requirePermission("logistics.read");
    requirePermission("logistics.move");
    const { food_id, type, quantity, reason } = body;
    if (Object.keys(body).some((key) => !["food_id", "type", "quantity", "reason"].includes(key))
      || !idValid(food_id) || !["entry", "exit"].includes(type) || !idValid(quantity)
      || quantity > stockLimit || typeof reason !== "string" || reason.trim().length < 5 || reason.length > 300)
      fail(400, "Indica lote, tipo, cantidad entera y motivo (5 a 300 caracteres)");
    const result = transaction(() => {
      const lot = db.prepare("SELECT id,status,quantity,expires FROM foods WHERE id=?").get(food_id);
      if (!lot) fail(404, "Lote no encontrado");
      if (lot.status !== "available") fail(409, "El lote ya está cerrado; registra un lote nuevo para reponerlo");
      if (lot.expires < date) fail(409, "El lote está vencido. Usa una operación de descarte para retirarlo");
      const after = lot.quantity + (type === "entry" ? quantity : -quantity);
      if (after < 0) fail(409, "Existencias insuficientes para esta salida");
      if (after > stockLimit) fail(409, "El lote admite un máximo de 10 000 unidades");
      db.prepare("UPDATE foods SET quantity=?,status=? WHERE id=?").run(after, after ? "available" : "distributed", food_id);
      const id = recordMovement(db, { foodId: food_id, type, source: "logistics", before: lot.quantity, after, reason: reason.trim(), actor: user.id });
      audit(user.id, "logistics.movement", JSON.stringify({ id, food_id, type, quantity }), ip);
      return { id, quantity: after };
    });
    json(201, result);
    return true;
  }

  if (!stockPath && !movementPath && !exportType) fail(404, "Recurso no encontrado");
  if (req.method !== "GET") fail(405, "Método no permitido");
  requirePermission("logistics.read");
  if (exportType) requirePermission("logistics.report");
  const param = url.searchParams;
  const food = param.get("food_id") ?? "";
  const type = param.get("type") ?? "";
  const from = param.get("from") ?? "";
  const to = param.get("to") ?? "";
  const before = param.get("before") ?? "";
  if ((food && !idValid(Number(food))) || (before && !idValid(Number(before))) ||
      (type && !Object.hasOwn(types, type)) || (from && !dateValid(from)) ||
      (to && !dateValid(to)) || (from && to && from > to))
    fail(400, "Revisa los filtros del historial");

  if (stockPath || exportType === "stock") {
    const lots = db.prepare(`SELECT id,name,category,expires,
      CASE WHEN status='available' THEN quantity ELSE 0 END AS on_hand,
      CASE WHEN status='available' AND expires>=? THEN quantity ELSE 0 END AS available,
      status
      FROM foods ORDER BY name COLLATE NOCASE,expires,id`).all(date);
    if (!exportType) {
      json(200, { lots });
      return true;
    }
    const stockLabels = { available: "En inventario", distributed: "Agotado por salida", consumed: "Consumido", wasted: "Descartado" };
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="foodsave-existencias.csv"');
    audit(user.id, "logistics.report", JSON.stringify({ report: "stock", records: lots.length }), ip);
    res.end(csv([
      ["Lote", "Alimento", "Categoría", "Vencimiento", "Existencias físicas", "Disponible para salida", "Estado"],
      ...lots.map((l) => [l.id, l.name, l.category, l.expires, l.on_hand, l.available, l.on_hand && l.expires < date ? "Vencido" : stockLabels[l.status]]),
    ]));
    return true;
  }

  const conditions = [], values = [];
  if (food) { conditions.push("m.food_id=?"); values.push(Number(food)); }
  if (type) { conditions.push("m.type=?"); values.push(type); }
  // The report and UI both use the calendar date in Santo Domingo (UTC−04:00).
  if (from) { conditions.push("date(m.created_at,'-4 hours')>=?"); values.push(from); }
  if (to) { conditions.push("date(m.created_at,'-4 hours')<=?"); values.push(to); }
  if (before && !exportType) { conditions.push("m.id<?"); values.push(Number(before)); }
  const rows = db.prepare(`SELECT m.*,f.name food_name,u.name actor_name
    FROM stock_movements m JOIN foods f ON f.id=m.food_id LEFT JOIN users u ON u.id=m.actor_id
    ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY m.id DESC${exportType ? "" : " LIMIT 51"}`).all(...values);
  if (!exportType) {
    json(200, { movements: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null });
    return true;
  }
  const localTime = new Intl.DateTimeFormat("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "medium" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="foodsave-movimientos.csv"');
  audit(user.id, "logistics.report", JSON.stringify({ report: "movements", records: rows.length }), ip);
  res.end(csv([
    ["Movimiento", "Fecha y hora (Santo Domingo)", "Lote", "Alimento", "Tipo", "Origen", "Cantidad", "Antes", "Después", "Motivo", "Responsable", "Operación"],
    ...rows.map((m) => [m.id, localTime.format(new Date(m.created_at.replace(" ", "T") + "Z")), m.food_id, m.food_name,
      types[m.type], sources[m.source], m.quantity, m.before_qty, m.after_qty, m.reason, m.actor_name, m.operation_id]),
  ]));
  return true;
}
