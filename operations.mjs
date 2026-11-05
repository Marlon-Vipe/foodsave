export const operationPermissions = [
  "operations.read",
  "operations.manage",
  "operations.close",
  "operations.report",
];
export const operationDefaults = {
  administrador: operationPermissions,
  editor: ["operations.read", "operations.manage"],
  supervisor: ["operations.read", "operations.close", "operations.report"],
};
export const operationStates = [
  "pendiente",
  "en_proceso",
  "cerrada",
  "cancelada",
];
export const operationTypes = ["consumo", "descarte"];
export function initializeOperations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS operations(
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('consumo','descarte')),
 food_id INTEGER NOT NULL REFERENCES foods(id), quantity INTEGER NOT NULL CHECK(quantity>0),
 responsible_id INTEGER NOT NULL REFERENCES users(id), scheduled_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_proceso','cerrada','cancelada')),
 notes TEXT NOT NULL DEFAULT '', close_note TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at TEXT,
 version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS operation_history(
 id INTEGER PRIMARY KEY, operation_id INTEGER NOT NULL REFERENCES operations(id),actor_id INTEGER NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS operations_state_date_owner ON operations(status,scheduled_date,responsible_id);
 CREATE INDEX IF NOT EXISTS operations_date ON operations(scheduled_date);
 CREATE INDEX IF NOT EXISTS operations_owner ON operations(responsible_id);
 CREATE INDEX IF NOT EXISTS operation_history_operation ON operation_history(operation_id,id);`);
  if (
    db
      .prepare("SELECT id FROM schema_migrations WHERE id=?")
      .get("operations-v1")
  )
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [role, added] of Object.entries(operationDefaults)) {
      const row = db
        .prepare("SELECT permissions FROM roles WHERE id=?")
        .get(role);
      if (row) {
        const next = [...new Set([...JSON.parse(row.permissions), ...added])];
        db.prepare("UPDATE roles SET permissions=? WHERE id=?").run(
          JSON.stringify(next),
          role,
        );
        db.prepare(
          "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)",
        ).run(role);
      }
    }
    db.prepare("INSERT INTO schema_migrations(id) VALUES (?)").run(
      "operations-v1",
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const validText = (value, min, max) =>
  typeof value === "string" &&
  value.trim().length >= min &&
  value.length <= max;
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
export function eligibleOwners(db) {
  return db
    .prepare(
      "SELECT u.id,u.name,u.email,r.permissions FROM users u JOIN roles r ON r.id=u.role WHERE u.active=1 ORDER BY u.name,u.id",
    )
    .all()
    .filter((u) => JSON.parse(u.permissions).includes("operations.manage"))
    .map(({ permissions, ...u }) => u);
}
export function operationFilters(url, fail) {
  const allowed = ["status", "from", "to", "responsible_id"];
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      fail(400, "Filtro inválido");
  const status = url.searchParams.get("status"),
    from = url.searchParams.get("from"),
    to = url.searchParams.get("to"),
    responsible = url.searchParams.get("responsible_id");
  if (status && !operationStates.includes(status))
    fail(400, "Estado de operación inválido");
  if (
    (from && !validDate(from)) ||
    (to && !validDate(to)) ||
    (from && to && from > to)
  )
    fail(400, "Rango de fechas inválido");
  if (
    responsible &&
    (!/^\d+$/.test(responsible) || !positiveInt(Number(responsible)))
  )
    fail(400, "Responsable inválido");
  const conditions = [],
    values = [];
  for (const [condition, value] of [
    ["o.status=?", status],
    ["o.scheduled_date>=?", from],
    ["o.scheduled_date<=?", to],
    ["o.responsible_id=?", responsible],
  ])
    if (value) {
      conditions.push(condition);
      values.push(value);
    }
  return {
    sql: conditions.length ? " WHERE " + conditions.join(" AND ") : "",
    values,
    applied: {
      status: status || null,
      from: from || null,
      to: to || null,
      responsible_id: responsible ? Number(responsible) : null,
    },
  };
}
const operationSelect =
  "SELECT o.*,f.name food_name,u.name responsible_name,c.name creator_name FROM operations o JOIN foods f ON f.id=o.food_id JOIN users u ON u.id=o.responsible_id JOIN users c ON c.id=o.created_by";
export function listOperations(db, filters) {
  return db
    .prepare(
      operationSelect +
        filters.sql +
        " ORDER BY o.scheduled_date DESC,o.id DESC",
    )
    .all(...filters.values);
}
const stateLabel = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function operationReport(rows, filters, user, format) {
  const now = new Date().toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
  });
  const totals = operationStates.map((s) => [
    stateLabel[s],
    rows.filter((o) => o.status === s).length,
  ]);
  const filterText = `Estado: ${filters.status ? stateLabel[filters.status] : "Todos"} · Fecha prevista: ${filters.from || "sin inicio"} a ${filters.to || "sin fin"} · Responsable: ${filters.responsible_id ? rows.find((o) => o.responsible_id === filters.responsible_id)?.responsible_name || "#" + filters.responsible_id : "Todos"}`;
  const headers = [
    "ID",
    "Operación",
    "Tipo",
    "Alimento",
    "Cantidad",
    "Estado",
    "Fecha prevista",
    "Responsable",
    "Creada (UTC)",
    "Cerrada (UTC)",
    "Observaciones de cierre",
  ];
  const data = rows.map((o) => [
    o.id,
    o.title,
    o.type,
    o.food_name,
    o.quantity,
    stateLabel[o.status],
    o.scheduled_date,
    o.responsible_name,
    o.created_at,
    o.closed_at || "",
    o.close_note || "",
  ]);
  if (format === "csv")
    return (
      "\uFEFF" +
      [
        ["FoodSave · Reporte de operaciones"],
        ["Generado (Santo Domingo)", now],
        ["Preparado por", user.name],
        ["Filtros", filterText],
        ["Total", rows.length],
        ...totals,
        [],
        headers,
        ...data,
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n") +
      "\r\n"
    );
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte de operaciones · FoodSave</title><link rel="stylesheet" href="/report.css"><script src="/report.js" defer></script></head><body><div class="toolbar"><button id="print-report">Imprimir / guardar como PDF</button><a href="/">Volver a FoodSave</a></div><main><header><span class="brand">foodsave.</span><h1>Reporte de operaciones</h1><p>Generado: ${escapeHTML(now)} · Santo Domingo</p><p>Preparado por: ${escapeHTML(user.name)}</p><p>${escapeHTML(filterText)}</p></header><section class="summary"><div>Total<strong>${rows.length}</strong></div>${totals.map(([label, count]) => `<div>${label}<strong>${count}</strong></div>`).join("")}</section><p class="note">El reporte incluye todas las operaciones que cumplen los filtros. Cantidades en unidades. Las fechas de creación y cierre del detalle se expresan en UTC.</p><div class="operation-report-table"><table><thead><tr>${["ID", "Operación / alimento", "Cantidad", "Estado", "Fecha prevista", "Responsable"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((o) => `<tr><td>${o.id}</td><td>${escapeHTML(o.title)}<br>${escapeHTML(o.type)} · ${escapeHTML(o.food_name)}${o.close_note ? "<br>Cierre: " + escapeHTML(o.close_note) : ""}</td><td>${o.quantity}</td><td>${stateLabel[o.status]}</td><td>${o.scheduled_date}</td><td>${escapeHTML(o.responsible_name)}</td></tr>`).join("") || '<tr><td colspan="6">No hay operaciones para los filtros seleccionados.</td></tr>'}</tbody></table></div><footer>FoodSave · Gestión operativa</footer></main></body></html>`;
}
export function handleOperations(ctx) {
  const {
    req,
    res,
    path,
    url,
    db,
    user,
    body,
    requirePermission,
    audit,
    transaction,
    json,
    fail,
  } = ctx;
  if (!path.startsWith("/api/operations")) return false;
  const ip = req.socket.remoteAddress;
  const raw = (id) => db.prepare("SELECT * FROM operations WHERE id=?").get(id);
  const detail = (id) => db.prepare(operationSelect + " WHERE o.id=?").get(id);
  const history = (id, action, before, after, note = "") => {
    db.prepare(
      "INSERT INTO operation_history(operation_id,actor_id,action,before_json,after_json,note) VALUES (?,?,?,?,?,?)",
    ).run(
      id,
      user.id,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      note,
    );
    audit(
      user.id,
      "operation." + action,
      JSON.stringify({ id, version: after.version }),
      ip,
    );
  };
  const validate = (data) => {
    if (
      !validText(data.title, 3, 120) ||
      !operationTypes.includes(data.type) ||
      !positiveInt(data.food_id) ||
      !positiveInt(data.quantity) ||
      data.quantity > 10000 ||
      !positiveInt(data.responsible_id) ||
      !validDate(data.scheduled_date) ||
      !validText(data.notes, 0, 1000)
    )
      fail(400, "Revisa título, tipo, alimento, cantidad, fecha y responsable");
    if (!eligibleOwners(db).some((u) => u.id === data.responsible_id))
      fail(
        400,
        "Selecciona un responsable activo con permiso para gestionar operaciones",
      );
    const food = db.prepare("SELECT * FROM foods WHERE id=?").get(data.food_id);
    if (!food || food.status !== "available" || food.quantity < data.quantity)
      fail(
        409,
        "El alimento no está disponible o no tiene existencias suficientes",
      );
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Santo_Domingo",
    });
    if (data.type === "consumo" && data.scheduled_date > food.expires)
      fail(409, "La fecha prevista de consumo no puede superar el vencimiento");
    if (data.type === "consumo" && food.expires < today)
      fail(
        409,
        "No se puede programar o cerrar el consumo de un alimento vencido",
      );
  };
  const ensureVersion = (current) => {
    if (!positiveInt(body.expected_version))
      fail(400, "Se requiere la versión de la operación");
    if (body.expected_version !== current.version)
      fail(
        409,
        "La operación cambió. Actualiza la información antes de continuar",
      );
    if (["cerrada", "cancelada"].includes(current.status))
      fail(409, "Las operaciones cerradas o canceladas no se pueden modificar");
  };
  if (path === "/api/operations/options" && req.method === "GET") {
    requirePermission("operations.read");
    json(200, {
      owners: eligibleOwners(db),
      responsibles: db
        .prepare(
          "SELECT DISTINCT u.id,u.name FROM users u JOIN operations o ON o.responsible_id=u.id ORDER BY u.name,u.id",
        )
        .all(),
      foods: db
        .prepare(
          "SELECT id,name,quantity,expires FROM foods WHERE status='available' ORDER BY name,id",
        )
        .all(),
    });
    return true;
  }
  if (
    ["/api/operations/export.csv", "/api/operations/print"].includes(path) &&
    req.method === "GET"
  ) {
    requirePermission("operations.report");
    const filters = operationFilters(url, fail),
      rows = listOperations(db, filters),
      format = path.endsWith(".csv") ? "csv" : "print";
    const report = operationReport(rows, filters.applied, user, format);
    audit(
      user.id,
      "operation.report",
      JSON.stringify({
        format,
        records: rows.length,
        filters: filters.applied,
      }),
      ip,
    );
    res.setHeader(
      "Content-Type",
      format === "csv" ? "text/csv; charset=utf-8" : "text/html; charset=utf-8",
    );
    if (format === "csv")
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="foodsave-operaciones-${new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" })}.csv"`,
      );
    res.end(report);
    return true;
  }
  if (path === "/api/operations" && req.method === "GET") {
    requirePermission("operations.read");
    const filters = operationFilters(url, fail),
      operations = listOperations(db, filters);
    json(200, { operations, filters: filters.applied });
    return true;
  }
  if (path === "/api/operations" && req.method === "POST") {
    requirePermission("operations.manage");
    const allowed = [
      "title",
      "type",
      "food_id",
      "quantity",
      "responsible_id",
      "scheduled_date",
      "notes",
    ];
    if (Object.keys(body).some((k) => !allowed.includes(k)))
      fail(400, "Campos de operación inválidos");
    const data = { ...body, notes: body.notes ?? "" };
    const id = transaction(() => {
      validate(data);
      const r = db
        .prepare(
          "INSERT INTO operations(title,type,food_id,quantity,responsible_id,scheduled_date,notes,created_by) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          data.title.trim(),
          data.type,
          data.food_id,
          data.quantity,
          data.responsible_id,
          data.scheduled_date,
          data.notes.trim(),
          user.id,
        );
      const id = Number(r.lastInsertRowid);
      history(id, "created", null, raw(id));
      return id;
    });
    json(201, { operation: detail(id) });
    return true;
  }
  const match = path.match(
    /^\/api\/operations\/([1-9]\d*)(?:\/(start|close|cancel))?$/,
  );
  if (!match) fail(404, "Operación o acción no encontrada");
  const id = Number(match[1]),
    action = match[2];
  if (!Number.isSafeInteger(id)) fail(400, "Identificador inválido");
  if (req.method === "GET" && !action) {
    requirePermission("operations.read");
    const operation = detail(id);
    if (!operation) fail(404, "Operación no encontrada");
    const changes = db
      .prepare(
        "SELECT h.*,u.name actor_name FROM operation_history h JOIN users u ON u.id=h.actor_id WHERE h.operation_id=? ORDER BY h.id",
      )
      .all(id)
      .map((h) => ({
        ...h,
        before: h.before_json ? JSON.parse(h.before_json) : null,
        after: JSON.parse(h.after_json),
      }))
      .map(({ before_json, after_json, ...h }) => h);
    json(200, { operation, history: changes });
    return true;
  }
  if (req.method === "PATCH" && !action) {
    requirePermission("operations.manage");
    const fields = [
      "title",
      "type",
      "food_id",
      "quantity",
      "responsible_id",
      "scheduled_date",
      "notes",
    ];
    if (
      Object.keys(body).some(
        (k) => !fields.includes(k) && k !== "expected_version",
      ) ||
      !fields.some((k) => Object.hasOwn(body, k))
    )
      fail(400, "Incluye al menos un campo editable");
    transaction(() => {
      const current = raw(id);
      if (!current) fail(404, "Operación no encontrada");
      ensureVersion(current);
      const data = { ...current, ...body };
      validate(data);
      db.prepare(
        "UPDATE operations SET title=?,type=?,food_id=?,quantity=?,responsible_id=?,scheduled_date=?,notes=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?",
      ).run(
        data.title.trim(),
        data.type,
        data.food_id,
        data.quantity,
        data.responsible_id,
        data.scheduled_date,
        data.notes.trim(),
        id,
      );
      history(id, "updated", current, raw(id));
    });
    json(200, { operation: detail(id) });
    return true;
  }
  if (req.method === "POST" && action) {
    requirePermission(
      action === "close" ? "operations.close" : "operations.manage",
    );
    if (
      Object.keys(body).some((k) => !["expected_version", "note"].includes(k))
    )
      fail(400, "Campos de acción inválidos");
    if (action !== "start" && !validText(body.note, 5, 1000))
      fail(400, "Incluye una observación de 5 a 1000 caracteres");
    transaction(() => {
      const current = raw(id);
      if (!current) fail(404, "Operación no encontrada");
      ensureVersion(current);
      if (action === "start") {
        if (current.status !== "pendiente")
          fail(409, "Solo una operación pendiente puede iniciarse");
        validate(current);
        db.prepare(
          "UPDATE operations SET status='en_proceso',updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?",
        ).run(id);
      } else if (action === "close") {
        if (current.status !== "en_proceso")
          fail(409, "Inicia la operación antes de cerrarla");
        validate(current);
        const food = db
            .prepare("SELECT * FROM foods WHERE id=?")
            .get(current.food_id),
          remaining = food.quantity - current.quantity;
        db.prepare("UPDATE foods SET quantity=?,status=? WHERE id=?").run(
          remaining,
          remaining > 0
            ? "available"
            : current.type === "consumo"
              ? "consumed"
              : "wasted",
          food.id,
        );
        db.prepare(
          "UPDATE operations SET status='cerrada',close_note=?,closed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?",
        ).run(body.note.trim(), id);
      } else {
        db.prepare(
          "UPDATE operations SET status='cancelada',close_note=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?",
        ).run(body.note.trim(), id);
      }
      history(
        id,
        action === "start"
          ? "started"
          : action === "close"
            ? "closed"
            : "cancelled",
        current,
        raw(id),
        action === "start" ? "" : body.note.trim(),
      );
    });
    json(200, { operation: detail(id) });
    return true;
  }
  fail(405, "Método no permitido");
}
