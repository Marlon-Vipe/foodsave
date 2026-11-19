import { collectFinance, todayDO, validCents, validDate, validText } from "./finance-store.mjs";

const monthValid = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const requestIdValid = (value) => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const onlyFields = (data, allowed) => Object.keys(data).every((key) => allowed.includes(key));

export function handleFinance(context) {
  const { req, res, path, url, body, user, db, requirePermission, fail, json, transaction, audit } = context;
  if (!path.startsWith("/api/finance/")) return false;
  requirePermission("finance.read");
  const ip = req.socket.remoteAddress;
  if (path === "/api/finance/summary" || path === "/api/finance/export.csv") {
    if (req.method !== "GET") fail(405, "Método no permitido");
    const month = url.searchParams.get("month") ?? todayDO().slice(0, 7);
    if (!monthValid(month)) fail(400, "Selecciona un mes válido");
    if (path.endsWith(".csv")) requirePermission("finance.report");
    const data = collectFinance(db, month);
    if (!path.endsWith(".csv")) {
      json(200, data);
      return true;
    }
    const rows = [
      ["FoodSave · Finanzas", "RD$", month],
      ["Gasto registrado", (data.summary.spending_cents / 100).toFixed(2)],
      ["Ayudas recibidas", (data.summary.aid_cents / 100).toFixed(2)],
      ["Pérdida por descarte registrada", (data.summary.waste_cents / 100).toFixed(2)],
      ["Valor actual en riesgo (7 días)", (data.summary.risk_cents / 100).toFixed(2)],
      ["Valor actual vencido", (data.summary.expired_value_cents / 100).toFixed(2)],
      ["Lotes actuales sin costo", data.summary.unpriced_lots],
      ["Movimientos del mes sin costo", data.summary.unpriced_movements],
      [],
      ["Fecha", "Tipo", "Descripción", "Cantidad", "Costo unitario RD$", "Importe RD$"],
      ...data.movements.map((row) => [row.booked_on ?? row.created_at, row.kind ?? "Sin costo", row.name,
        row.quantity, row.unit_cost_cents === null ? "" : (row.unit_cost_cents / 100).toFixed(2),
        row.total_cents === null ? "" : (row.total_cents / 100).toFixed(2)]),
      ...data.economic.map((row) => [row.booked_on, row.kind === "aid" ? "Ayuda" : "Gasto adicional",
        row.description, "", "", (row.amount_cents / 100).toFixed(2)]),
    ];
    const cell = (value) => {
      let text = String(value ?? "");
      if (/^\s*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    audit(user.id, "finance.report", month, ip);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="foodsave-finanzas-' + month + '.csv"');
    res.end("\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n"));
    return true;
  }
  requirePermission("finance.manage");
  if (path === "/api/finance/lot-costs" && req.method === "POST") {
    if (!onlyFields(body, ["food_id", "unit_cost_cents"]) || !Number.isSafeInteger(body.food_id) ||
        body.food_id < 1 || !validCents(body.unit_cost_cents)) fail(400, "Revisa el lote y su costo unitario");
    transaction(() => {
      const lot = db.prepare("SELECT status FROM foods WHERE id=?").get(body.food_id);
      if (!lot || lot.status !== "available") fail(409, "Selecciona un lote en inventario");
      if (db.prepare("SELECT 1 FROM lot_costs WHERE food_id=?").get(body.food_id))
        fail(409, "El lote ya tiene un costo. Registra un lote nuevo si cambia el precio");
      db.prepare("INSERT INTO lot_costs(food_id,unit_cost_cents,actor_id) VALUES (?,?,?)")
        .run(body.food_id, body.unit_cost_cents, user.id);
      audit(user.id, "finance.cost.recorded", body.food_id, ip);
    });
    json(201, { ok: true });
    return true;
  }
  if (path === "/api/finance/budget" && req.method === "PUT") {
    if (!onlyFields(body, ["month", "amount_cents", "expected_version"]) ||
        !monthValid(body.month) || !validCents(body.amount_cents) ||
        !Number.isSafeInteger(body.expected_version) || body.expected_version < 0)
      fail(400, "Revisa mes, presupuesto y versión");
    transaction(() => {
      const current = db.prepare("SELECT version FROM monthly_budgets WHERE month=?").get(body.month);
      if ((current?.version ?? 0) !== body.expected_version) fail(409, "El presupuesto cambió. Actualiza la pantalla");
      db.prepare(`INSERT INTO monthly_budgets(month,amount_cents,actor_id) VALUES (?,?,?)
        ON CONFLICT(month) DO UPDATE SET amount_cents=excluded.amount_cents,
        actor_id=excluded.actor_id,version=monthly_budgets.version+1`)
        .run(body.month, body.amount_cents, user.id);
      audit(user.id, "finance.budget.updated", body.month, ip);
    });
    json(200, { ok: true });
    return true;
  }
  if (path === "/api/finance/records" && req.method === "POST") {
    if (!onlyFields(body, ["kind", "amount_cents", "description", "booked_on", "request_id"]) ||
        !["aid", "expense"].includes(body.kind) || !validCents(body.amount_cents) || body.amount_cents === 0 ||
        !validText(body.description) || !validDate(body.booked_on) || body.booked_on > todayDO() ||
        !requestIdValid(body.request_id))
      fail(400, "Revisa tipo, importe, descripción y fecha del registro");
    const id = transaction(() => {
      const previous = db.prepare("SELECT * FROM economic_records WHERE request_id=?").get(body.request_id);
      if (previous) {
        if (previous.actor_id !== user.id || previous.kind !== body.kind || previous.amount_cents !== body.amount_cents ||
            previous.description !== body.description.trim() || previous.booked_on !== body.booked_on)
          fail(409, "La solicitud ya se utilizó para otro registro");
        return previous.id;
      }
      const result = db.prepare(`INSERT INTO economic_records(kind,description,amount_cents,booked_on,actor_id,request_id)
        VALUES (?,?,?,?,?,?)`).run(body.kind, body.description.trim(), body.amount_cents, body.booked_on, user.id, body.request_id);
      audit(user.id, "finance." + body.kind + ".recorded", result.lastInsertRowid, ip);
      return Number(result.lastInsertRowid);
    });
    json(201, { id });
    return true;
  }
  fail(404, "Recurso financiero no encontrado");
}
