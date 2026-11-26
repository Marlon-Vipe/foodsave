import {
  businessToday, validDate, validText, validAmount, validValue, positiveId,
  checkFields, checkVersion, requireRecord, checkOwner, businessOwners,
  appendBusinessHistory, validateFilters, exportCSV,
} from "./business-utils.mjs";

export const businessStates = ["draft", "active", "completed", "archived"];
export const projectStates = ["planned", "active", "completed"];
const transitions = {
  draft: ["active", "archived"], active: ["completed"],
  completed: ["active", "archived"], archived: ["draft"],
};
const businessFields = ["name", "description", "kind", "owner_id", "budget_cents", "currency", "sdg_ids"];

function snapshot(db, id) {
  const row = db.prepare("SELECT * FROM businesses WHERE id=?").get(id);
  return row && { ...row, sdg_ids: db.prepare("SELECT sdg_id FROM business_sdgs WHERE business_id=? ORDER BY sdg_id").all(id).map((r) => r.sdg_id) };
}
function validateBusiness(db, data, fail) {
  if (!validText(data.name) || !validText(data.description, 5, 1000) ||
      !["initiative", "product", "service"].includes(data.kind) ||
      !validAmount(data.budget_cents) || !["DOP", "USD"].includes(data.currency) ||
      !Array.isArray(data.sdg_ids) || !data.sdg_ids.length || data.sdg_ids.length > 17 ||
      new Set(data.sdg_ids).size !== data.sdg_ids.length ||
      data.sdg_ids.some((id) => !Number.isInteger(id) || id < 1 || id > 17))
    fail(400, "Revisa nombre, descripción, tipo, presupuesto y al menos un ODS");
  checkOwner(db, data.owner_id, fail);
}
function writeSDGs(db, businessId, ids) {
  const insert = db.prepare("INSERT OR IGNORE INTO business_sdgs VALUES (?,?)");
  for (const id of ids) insert.run(businessId, id);
  const previous = db.prepare("SELECT sdg_id FROM business_sdgs WHERE business_id=?").all(businessId);
  for (const row of previous)
    if (!ids.includes(row.sdg_id)) db.prepare("DELETE FROM business_sdgs WHERE business_id=? AND sdg_id=?").run(businessId, row.sdg_id);
}
export function listIndicators(db, businessId) {
  const rows = db.prepare(`SELECT i.*,s.name sdg_name,p.name project_name,
      m.value current_value,m.measured_on,m.evidence,m.id measurement_id
    FROM business_indicators i JOIN sdgs s ON s.id=i.sdg_id
    LEFT JOIN business_projects p ON p.id=i.project_id
    LEFT JOIN indicator_measurements m ON m.id=(
      SELECT id FROM indicator_measurements WHERE indicator_id=i.id ORDER BY measured_on DESC,id DESC LIMIT 1
    ) WHERE i.business_id=? ORDER BY i.dimension,i.id`).all(businessId);
  return rows.map((row) => {
    const measured = row.current_value !== null;
    const reached = measured && (row.target > row.baseline ? row.current_value >= row.target : row.current_value <= row.target);
    const progress = measured ? Math.round(Math.max(0, Math.min(100, (row.current_value - row.baseline) / (row.target - row.baseline) * 100)) * 100) / 100 : null;
    return { ...row, progress, reached, overdue: row.due_on < businessToday() && !reached };
  });
}
export function listBusinesses(db, filters = {}) {
  const where = [], values = [];
  if (filters.status) { where.push("b.status=?"); values.push(filters.status); }
  if (filters.sdg_id) { where.push("EXISTS(SELECT 1 FROM business_sdgs x WHERE x.business_id=b.id AND x.sdg_id=?)"); values.push(filters.sdg_id); }
  const rows = db.prepare(`SELECT b.*,u.name owner_name,
    (SELECT COUNT(*) FROM business_projects p WHERE p.business_id=b.id) project_count,
    (SELECT COUNT(*) FROM business_indicators i WHERE i.business_id=b.id) indicator_count
    FROM businesses b JOIN users u ON u.id=b.owner_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY b.id DESC`).all(...values);
  const links = db.prepare("SELECT x.business_id,s.id,s.name FROM business_sdgs x JOIN sdgs s ON s.id=x.sdg_id ORDER BY s.id").all();
  return rows.map((row) => ({ ...row, sdgs: links.filter((link) => link.business_id === row.id).map(({ id, name }) => ({ id, name })) }));
}

export function handleBusinesses(context) {
  const { path, req, res, url, db, user, body, fail, requirePermission, transaction, json, audit } = context;
  if (!path.startsWith("/api/businesses")) return false;
  requirePermission("business.read");
  if (path === "/api/businesses/options" && req.method === "GET") {
    json(200, { sdgs: db.prepare("SELECT * FROM sdgs ORDER BY id").all(), owners: businessOwners(db) });
    return true;
  }
  if ((path === "/api/businesses" || path === "/api/businesses/export.csv") && req.method === "GET") {
    validateFilters(url, ["status", "sdg_id"], fail);
    const status = url.searchParams.get("status") || "";
    const sdg = url.searchParams.get("sdg_id") || "";
    if ((status && !businessStates.includes(status)) || (sdg && (!positiveId(Number(sdg)) || Number(sdg) > 17)))
      fail(400, "Revisa los filtros de negocios");
    const rows = listBusinesses(db, { status, sdg_id: sdg ? Number(sdg) : null });
    if (path.endsWith(".csv")) {
      requirePermission("business.report");
      const data = [["Negocio", "Tipo", "Estado", "Responsable", "ODS", "Presupuesto", "Moneda", "Indicador", "Dimensión", "Unidad", "Base", "Meta", "Valor medido", "Progreso %", "Fecha límite", "Fecha de medición", "Evidencia"]];
      for (const business of rows) {
        const indicators = listIndicators(db, business.id);
        const prefix = [business.name, business.kind, business.status, business.owner_name,
          business.sdgs.map((s) => s.id).join(" / "), (business.budget_cents / 100).toFixed(2), business.currency];
        if (!indicators.length) data.push([...prefix, ...Array(10).fill("")]);
        for (const indicator of indicators) data.push([...prefix, indicator.name, indicator.dimension, indicator.unit,
          indicator.baseline, indicator.target, indicator.current_value, indicator.progress,
          indicator.due_on, indicator.measured_on, indicator.evidence]);
      }
      exportCSV(res, audit, user, req.socket.remoteAddress, "negocios-impacto", data);
    } else json(200, { businesses: rows });
    return true;
  }
  if (path === "/api/businesses" && req.method === "POST") {
    requirePermission("business.manage");
    checkFields(body, businessFields, [], fail);
    validateBusiness(db, body, fail);
    const id = transaction(() => {
      const result = db.prepare(`INSERT INTO businesses(name,description,kind,owner_id,budget_cents,currency)
        VALUES (?,?,?,?,?,?)`).run(body.name.trim(), body.description.trim(), body.kind, body.owner_id, body.budget_cents, body.currency);
      const id = Number(result.lastInsertRowid);
      writeSDGs(db, id, body.sdg_ids);
      appendBusinessHistory(context, id, "created", null, snapshot(db, id));
      return id;
    });
    json(201, { business: snapshot(db, id) });
    return true;
  }
  let match = /^\/api\/businesses\/(\d+)$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    requireRecord(db, "businesses", id, fail);
    if (req.method === "GET") {
      json(200, { business: snapshot(db, id),
        projects: db.prepare("SELECT p.*,u.name owner_name FROM business_projects p JOIN users u ON u.id=p.owner_id WHERE business_id=? ORDER BY p.id").all(id),
        indicators: listIndicators(db, id),
        measurements: db.prepare(`SELECT m.*,u.name actor_name FROM indicator_measurements m
          JOIN business_indicators i ON i.id=m.indicator_id JOIN users u ON u.id=m.actor_id
          WHERE i.business_id=? ORDER BY m.measured_on DESC,m.id DESC`).all(id),
        history: db.prepare("SELECT h.*,u.name actor_name FROM business_history h JOIN users u ON u.id=h.actor_id WHERE business_id=? ORDER BY h.id DESC").all(id),
      });
      return true;
    }
    if (req.method !== "PATCH") fail(405, "Método no permitido");
    requirePermission("business.manage");
    checkFields(body, ["expected_version"], [...businessFields, "status"], fail);
    transaction(() => {
      const current = snapshot(db, id);
      checkVersion(current, body, fail);
      const next = { ...current, ...body };
      validateBusiness(db, next, fail);
      if (!businessStates.includes(next.status) ||
          (next.status !== current.status && !transitions[current.status].includes(next.status)))
        fail(409, "Transición de negocio no permitida");
      if (current.status === "archived" && next.status !== "draft")
        fail(409, "Restaura el negocio a borrador antes de editarlo");
      if (next.status === "completed" && current.status !== "completed" &&
          db.prepare("SELECT 1 FROM business_projects WHERE business_id=? AND status!='completed'").get(id))
        fail(409, "Finaliza los proyectos pendientes antes de completar el negocio");
      const referenced = db.prepare("SELECT DISTINCT sdg_id FROM business_indicators WHERE business_id=?").all(id);
      if (referenced.some((row) => !next.sdg_ids.includes(row.sdg_id)))
        fail(409, "Conserva los ODS que ya tienen indicadores asociados");
      db.prepare(`UPDATE businesses SET name=?,description=?,kind=?,owner_id=?,status=?,budget_cents=?,currency=?,version=version+1 WHERE id=?`)
        .run(next.name.trim(), next.description.trim(), next.kind, next.owner_id, next.status, next.budget_cents, next.currency, id);
      writeSDGs(db, id, next.sdg_ids);
      appendBusinessHistory(context, id, next.status === current.status ? "updated" : "status.changed", current, snapshot(db, id));
    });
    json(200, { business: snapshot(db, id) });
    return true;
  }
  match = /^\/api\/businesses\/(\d+)\/projects$/.exec(path);
  if (match && req.method === "POST") {
    requirePermission("business.manage");
    const businessId = Number(match[1]);
    checkFields(body, ["name", "owner_id", "starts_on", "ends_on"], [], fail);
    const id = transaction(() => {
      const parent = requireRecord(db, "businesses", businessId, fail);
      if (!["draft", "active"].includes(parent.status)) fail(409, "Reabre el negocio para añadir proyectos");
      if (!validText(body.name) || !validDate(body.starts_on) || !validDate(body.ends_on) || body.ends_on < body.starts_on)
        fail(400, "Revisa nombre y rango de fechas del proyecto");
      checkOwner(db, body.owner_id, fail);
      const result = db.prepare("INSERT INTO business_projects(business_id,name,owner_id,starts_on,ends_on) VALUES (?,?,?,?,?)")
        .run(businessId, body.name.trim(), body.owner_id, body.starts_on, body.ends_on);
      const id = Number(result.lastInsertRowid);
      appendBusinessHistory(context, businessId, "project.created", null, requireRecord(db, "business_projects", id, fail));
      return id;
    });
    json(201, { id });
    return true;
  }
  match = /^\/api\/businesses\/projects\/(\d+)$/.exec(path);
  if (match && req.method === "PATCH") {
    requirePermission("business.manage");
    const id = Number(match[1]);
    checkFields(body, ["expected_version"], ["name", "owner_id", "starts_on", "ends_on", "status"], fail);
    transaction(() => {
      const current = requireRecord(db, "business_projects", id, fail);
      const parent = requireRecord(db, "businesses", current.business_id, fail);
      if (!["draft", "active"].includes(parent.status)) fail(409, "Reabre el negocio antes de editar sus proyectos");
      checkVersion(current, body, fail);
      const next = { ...current, ...body };
      if (!validText(next.name) || !validDate(next.starts_on) || !validDate(next.ends_on) || next.ends_on < next.starts_on ||
          !projectStates.includes(next.status)) fail(400, "Datos de proyecto inválidos");
      checkOwner(db, next.owner_id, fail);
      const allowed = { planned: ["active"], active: ["completed"], completed: ["active"] };
      if ((next.status !== current.status && !allowed[current.status].includes(next.status)) ||
          (next.status === "active" && parent.status !== "active"))
        fail(409, "Activa el negocio e inicia el proyecto antes de completarlo");
      db.prepare("UPDATE business_projects SET name=?,owner_id=?,starts_on=?,ends_on=?,status=?,version=version+1 WHERE id=?")
        .run(next.name.trim(), next.owner_id, next.starts_on, next.ends_on, next.status, id);
      appendBusinessHistory(context, parent.id, "project.updated", current, requireRecord(db, "business_projects", id, fail));
    });
    json(200, { project: requireRecord(db, "business_projects", id, fail) });
    return true;
  }
  match = /^\/api\/businesses\/(\d+)\/indicators$/.exec(path);
  if (match && req.method === "POST") {
    requirePermission("business.manage");
    const businessId = Number(match[1]);
    checkFields(body, ["name", "dimension", "sdg_id", "unit", "baseline", "target", "due_on"], ["project_id"], fail);
    const id = transaction(() => {
      const parent = requireRecord(db, "businesses", businessId, fail);
      if (!["draft", "active"].includes(parent.status)) fail(409, "Reabre el negocio para definir indicadores");
      if (!validText(body.name) || !["economic", "social", "environmental"].includes(body.dimension) ||
          !validText(body.unit, 1, 40) || !validValue(body.baseline) || !validValue(body.target) ||
          Math.abs(body.target - body.baseline) < 0.000001 || !validDate(body.due_on) || !positiveId(body.sdg_id) ||
          !db.prepare("SELECT 1 FROM business_sdgs WHERE business_id=? AND sdg_id=?").get(businessId, body.sdg_id))
        fail(400, "Revisa el indicador, el ODS asociado, la unidad, la base y una meta diferente");
      const projectId = body.project_id ?? null;
      if (projectId !== null && (!positiveId(projectId) ||
          !db.prepare("SELECT 1 FROM business_projects WHERE id=? AND business_id=?").get(projectId, businessId)))
        fail(400, "Selecciona un proyecto del mismo negocio");
      const result = db.prepare(`INSERT INTO business_indicators(business_id,project_id,sdg_id,name,dimension,unit,baseline,target,due_on)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(businessId, projectId, body.sdg_id, body.name.trim(), body.dimension, body.unit.trim(), body.baseline, body.target, body.due_on);
      const id = Number(result.lastInsertRowid);
      appendBusinessHistory(context, businessId, "indicator.created", null, requireRecord(db, "business_indicators", id, fail));
      return id;
    });
    json(201, { id });
    return true;
  }
  match = /^\/api\/businesses\/indicators\/(\d+)\/measurements$/.exec(path);
  if (match && req.method === "POST") {
    requirePermission("business.manage");
    const id = Number(match[1]);
    checkFields(body, ["value", "measured_on", "evidence", "request_id"], [], fail);
    if (!validValue(body.value) || !validDate(body.measured_on) || body.measured_on > businessToday() ||
        !validText(body.evidence, 5, 1000) || typeof body.request_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.request_id))
      fail(400, "Revisa el valor medido, fecha actual o anterior y evidencia de la medición");
    const measurementId = transaction(() => {
      const indicator = requireRecord(db, "business_indicators", id, fail);
      const parent = requireRecord(db, "businesses", indicator.business_id, fail);
      if (parent.status === "archived") fail(409, "Restaura el negocio para registrar mediciones");
      const previous = db.prepare("SELECT * FROM indicator_measurements WHERE request_id=?").get(body.request_id);
      if (previous) {
        if (previous.indicator_id !== id || previous.actor_id !== user.id || previous.value !== body.value ||
            previous.measured_on !== body.measured_on || previous.evidence !== body.evidence.trim())
          fail(409, "La solicitud ya se utilizó para otra medición");
        return previous.id;
      }
      const result = db.prepare("INSERT INTO indicator_measurements(indicator_id,value,measured_on,evidence,actor_id,request_id) VALUES (?,?,?,?,?,?)")
        .run(id, body.value, body.measured_on, body.evidence.trim(), user.id, body.request_id);
      const measurementId = Number(result.lastInsertRowid);
      appendBusinessHistory(context, parent.id, "measurement.recorded", null, requireRecord(db, "indicator_measurements", measurementId, fail));
      return measurementId;
    });
    json(201, { id: measurementId });
    return true;
  }
  fail(404, "Recurso de negocio no encontrado");
}
