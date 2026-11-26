import {
  businessToday, validDate, validText, validAmount, positiveId, activeUser,
  checkFields, checkVersion, requireRecord, appendLicenseHistory, validateFilters, exportCSV,
} from "./business-utils.mjs";

export function assignmentRows(db, licenseId = null) {
  return db.prepare(`SELECT a.*,u.name user_name,u.active user_active,t.name target_name,t.kind target_kind,
      actor.name assigned_by_name,releaser.name released_by_name
    FROM license_assignments a LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN license_targets t ON t.id=a.target_id
    JOIN users actor ON actor.id=a.assigned_by LEFT JOIN users releaser ON releaser.id=a.released_by
    ${licenseId === null ? "" : "WHERE a.license_id=?"} ORDER BY a.id DESC`).all(...(licenseId === null ? [] : [licenseId]));
}
function allocated(db, licenseId) {
  return db.prepare("SELECT COALESCE(SUM(seats),0) seats FROM license_assignments WHERE license_id=? AND released_at IS NULL").get(licenseId).seats;
}
export function listLicenses(db, filters = {}) {
  const day = businessToday();
  const rows = db.prepare(`SELECT l.*,s.name software_name,s.vendor,b.name business_name,
    COALESCE((SELECT SUM(a.seats) FROM license_assignments a WHERE a.license_id=l.id AND a.released_at IS NULL),0) assigned
    FROM business_licenses l JOIN business_software s ON s.id=l.software_id
    LEFT JOIN businesses b ON b.id=l.business_id ORDER BY l.expires_on,l.id`).all();
  return rows.map((row) => {
    const state = !row.enabled ? "disabled" : row.expires_on < day ? "expired" : row.starts_on > day ? "scheduled" : "valid";
    const days_remaining = Math.round((Date.parse(row.expires_on) - Date.parse(day)) / 86400000);
    const expiring = state === "valid" && days_remaining <= (filters.days ?? 30);
    return { ...row, state, days_remaining, expiring, available: state === "valid" ? row.seats - row.assigned : 0 };
  }).filter((row) => (!filters.state || (filters.state === "expiring" ? row.expiring : row.state === filters.state)) &&
    (!filters.software_id || row.software_id === filters.software_id) &&
    (!filters.business_id || row.business_id === filters.business_id));
}
function licenseFilters(url, fail) {
  validateFilters(url, ["state", "days", "software_id", "business_id"], fail);
  const params = url.searchParams;
  const state = params.get("state") || "";
  const days = params.get("days") || "30";
  const software = params.get("software_id") || "";
  const business = params.get("business_id") || "";
  if ((state && !["valid", "expired", "scheduled", "disabled", "expiring"].includes(state)) ||
      !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 365 ||
      (software && !positiveId(Number(software))) || (business && !positiveId(Number(business))))
    fail(400, "Revisa estado, plazo de vencimiento y filtros de licencias");
  return { state, days: Number(days), software_id: software ? Number(software) : null, business_id: business ? Number(business) : null };
}
function validateLicense(db, data, fail) {
  if (!positiveId(data.software_id) || !db.prepare("SELECT id FROM business_software WHERE id=?").get(data.software_id) ||
      !validText(data.reference, 2, 80) || !Number.isInteger(data.seats) || data.seats < 1 || data.seats > 10000 ||
      !validDate(data.starts_on) || !validDate(data.expires_on) || data.expires_on < data.starts_on ||
      !validAmount(data.cost_cents) || !["DOP", "USD"].includes(data.currency) ||
      (data.enabled !== 0 && data.enabled !== 1))
    fail(400, "Revisa software, referencia, cupos, fechas, costo y estado de la licencia");
  if (data.business_id !== null && (!positiveId(data.business_id) ||
      !db.prepare("SELECT id FROM businesses WHERE id=?").get(data.business_id)))
    fail(400, "Selecciona un negocio registrado");
}
function referenceAvailable(db, reference, id, fail) {
  if (db.prepare("SELECT id FROM business_licenses WHERE reference=? COLLATE NOCASE AND id!=?").get(reference.trim(), id))
    fail(409, "Ya existe una licencia con esa referencia");
}

export function handleLicenses(context) {
  const { req, res, path, url, db, body, user, json, fail, transaction, audit, requirePermission } = context;
  if (!path.startsWith("/api/licenses")) return false;
  requirePermission("licenses.read");
  if (path === "/api/licenses/options" && req.method === "GET") {
    json(200, {
      software: db.prepare("SELECT * FROM business_software ORDER BY name,id").all(),
      targets: db.prepare("SELECT * FROM license_targets ORDER BY kind,name,id").all(),
      users: db.prepare("SELECT id,name,email FROM users WHERE active=1 ORDER BY name,id").all(),
      businesses: db.prepare("SELECT id,name FROM businesses ORDER BY name,id").all(),
    });
    return true;
  }
  if (["/api/licenses", "/api/licenses/export.csv", "/api/licenses/usage.csv"].includes(path) && req.method === "GET") {
    const filters = licenseFilters(url, fail);
    const rows = listLicenses(db, filters);
    if (path === "/api/licenses") json(200, { licenses: rows, date: businessToday() });
    else {
      requirePermission("licenses.report");
      let data;
      if (path.endsWith("usage.csv")) {
        const licenses = new Map(rows.map((row) => [row.id, row]));
        data = [["Licencia", "Software", "Negocio", "Tipo de destino", "Usuario/equipo/área", "Cupos", "Asignado el", "Asignado por", "Liberado el", "Liberado por", "Motivo de liberación"]];
        for (const assignment of assignmentRows(db)) {
          const license = licenses.get(assignment.license_id);
          if (license) data.push([license.reference, license.software_name, license.business_name,
            assignment.user_id ? "Usuario" : assignment.target_kind === "equipment" ? "Equipo" : "Área",
            assignment.user_name ?? assignment.target_name, assignment.seats,
            assignment.assigned_at, assignment.assigned_by_name, assignment.released_at,
            assignment.released_by_name, assignment.release_note]);
        }
      } else {
        data = [["Software", "Proveedor", "Referencia", "Negocio", "Inicio", "Vencimiento", "Días restantes", "Estado",
          "Cupos contratados", "Asignados", "Disponibles para asignar", "Costo", "Moneda"],
          ...rows.map((row) => [row.software_name, row.vendor, row.reference, row.business_name, row.starts_on, row.expires_on,
            row.days_remaining, row.state, row.seats, row.assigned, row.available, (row.cost_cents / 100).toFixed(2), row.currency])];
      }
      exportCSV(res, audit, user, req.socket.remoteAddress, path.endsWith("usage.csv") ? "uso-licencias" : "vigencias-licencias", data);
    }
    return true;
  }
  if (path === "/api/licenses/software" && req.method === "POST") {
    requirePermission("licenses.manage");
    checkFields(body, ["name", "vendor"], [], fail);
    if (!validText(body.name) || !validText(body.vendor)) fail(400, "Indica nombre del software y proveedor");
    const id = transaction(() => {
      if (db.prepare("SELECT id FROM business_software WHERE name=? COLLATE NOCASE AND vendor=? COLLATE NOCASE").get(body.name.trim(), body.vendor.trim()))
        fail(409, "Ese software y proveedor ya están registrados");
      const result = db.prepare("INSERT INTO business_software(name,vendor) VALUES (?,?)").run(body.name.trim(), body.vendor.trim());
      audit(user.id, "software.created", result.lastInsertRowid, req.socket.remoteAddress);
      return Number(result.lastInsertRowid);
    });
    json(201, { id });
    return true;
  }
  if (path === "/api/licenses/targets" && req.method === "POST") {
    requirePermission("licenses.manage");
    checkFields(body, ["kind", "name"], [], fail);
    if (!["equipment", "area"].includes(body.kind) || !validText(body.name)) fail(400, "Indica tipo y nombre del equipo o área");
    const id = transaction(() => {
      if (db.prepare("SELECT id FROM license_targets WHERE kind=? AND name=? COLLATE NOCASE").get(body.kind, body.name.trim()))
        fail(409, "Ese equipo o área ya está registrado");
      const result = db.prepare("INSERT INTO license_targets(kind,name) VALUES (?,?)").run(body.kind, body.name.trim());
      audit(user.id, "license.target.created", result.lastInsertRowid, req.socket.remoteAddress);
      return Number(result.lastInsertRowid);
    });
    json(201, { id });
    return true;
  }
  if (path === "/api/licenses" && req.method === "POST") {
    requirePermission("licenses.manage");
    checkFields(body, ["software_id", "reference", "seats", "starts_on", "expires_on", "cost_cents", "currency"], ["business_id"], fail);
    const data = { ...body, business_id: body.business_id ?? null, enabled: 1 };
    const id = transaction(() => {
      validateLicense(db, data, fail);
      referenceAvailable(db, data.reference, -1, fail);
      const result = db.prepare(`INSERT INTO business_licenses(software_id,business_id,reference,seats,starts_on,expires_on,cost_cents,currency)
        VALUES (?,?,?,?,?,?,?,?)`).run(data.software_id, data.business_id, data.reference.trim(), data.seats,
          data.starts_on, data.expires_on, data.cost_cents, data.currency);
      const id = Number(result.lastInsertRowid);
      appendLicenseHistory(context, id, "created", null, requireRecord(db, "business_licenses", id, fail));
      return id;
    });
    json(201, { id });
    return true;
  }
  let match = /^\/api\/licenses\/(\d+)$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    requireRecord(db, "business_licenses", id, fail);
    if (req.method === "GET") {
      json(200, {
        license: listLicenses(db).find((row) => row.id === id), assignments: assignmentRows(db, id),
        history: db.prepare("SELECT h.*,u.name actor_name FROM license_history h JOIN users u ON u.id=h.actor_id WHERE license_id=? ORDER BY h.id DESC").all(id),
      });
      return true;
    }
    if (req.method !== "PATCH") fail(405, "Método no permitido");
    requirePermission("licenses.manage");
    checkFields(body, ["expected_version"], ["reference", "business_id", "seats", "starts_on", "expires_on", "enabled", "cost_cents", "currency"], fail);
    transaction(() => {
      const current = requireRecord(db, "business_licenses", id, fail);
      checkVersion(current, body, fail);
      const next = { ...current, ...body };
      validateLicense(db, next, fail);
      referenceAvailable(db, next.reference, id, fail);
      if (next.seats < allocated(db, id)) fail(409, "Libera asignaciones antes de reducir los cupos contratados");
      db.prepare(`UPDATE business_licenses SET reference=?,business_id=?,seats=?,starts_on=?,expires_on=?,enabled=?,cost_cents=?,currency=?,version=version+1 WHERE id=?`)
        .run(next.reference.trim(), next.business_id, next.seats, next.starts_on, next.expires_on, next.enabled, next.cost_cents, next.currency, id);
      appendLicenseHistory(context, id, "updated", current, requireRecord(db, "business_licenses", id, fail));
    });
    json(200, { license: listLicenses(db).find((row) => row.id === id) });
    return true;
  }
  match = /^\/api\/licenses\/(\d+)\/assignments$/.exec(path);
  if (match && req.method === "POST") {
    requirePermission("licenses.manage");
    const id = Number(match[1]);
    checkFields(body, ["seats", "request_id"], ["user_id", "target_id"], fail);
    const userId = body.user_id ?? null, targetId = body.target_id ?? null;
    if (!Number.isInteger(body.seats) || body.seats < 1 || body.seats > 10000 ||
        (userId === null) === (targetId === null) ||
        typeof body.request_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.request_id))
      fail(400, "Selecciona un único usuario, equipo o área y una cantidad entera de cupos");
    const assignmentId = transaction(() => {
      const license = requireRecord(db, "business_licenses", id, fail);
      const previous = db.prepare("SELECT * FROM license_assignments WHERE request_id=?").get(body.request_id);
      if (previous) {
        if (previous.license_id !== id || previous.user_id !== userId || previous.target_id !== targetId ||
            previous.seats !== body.seats || previous.assigned_by !== user.id)
          fail(409, "La solicitud ya se utilizó para otra asignación");
        return previous.id;
      }
      if (!license.enabled || license.starts_on > businessToday() || license.expires_on < businessToday())
        fail(409, "La licencia debe estar habilitada y vigente para asignarla");
      if (userId !== null) activeUser(db, userId, fail);
      else requireRecord(db, "license_targets", targetId, fail);
      if (allocated(db, id) + body.seats > license.seats) fail(409, "No hay cupos disponibles para esta asignación");
      const duplicate = userId !== null
        ? db.prepare("SELECT 1 FROM license_assignments WHERE license_id=? AND user_id=? AND released_at IS NULL").get(id, userId)
        : db.prepare("SELECT 1 FROM license_assignments WHERE license_id=? AND target_id=? AND released_at IS NULL").get(id, targetId);
      if (duplicate) fail(409, "Ese destino ya tiene una asignación activa de la licencia");
      const result = db.prepare("INSERT INTO license_assignments(license_id,user_id,target_id,seats,assigned_by,request_id) VALUES (?,?,?,?,?,?)")
        .run(id, userId, targetId, body.seats, user.id, body.request_id);
      const assignmentId = Number(result.lastInsertRowid);
      appendLicenseHistory(context, id, "assigned", null, requireRecord(db, "license_assignments", assignmentId, fail));
      return assignmentId;
    });
    json(201, { id: assignmentId });
    return true;
  }
  match = /^\/api\/licenses\/assignments\/(\d+)\/release$/.exec(path);
  if (match && req.method === "POST") {
    requirePermission("licenses.manage");
    const id = Number(match[1]);
    checkFields(body, ["note"], [], fail);
    if (!validText(body.note, 5, 300)) fail(400, "Indica un motivo de liberación de 5 a 300 caracteres");
    transaction(() => {
      const current = requireRecord(db, "license_assignments", id, fail);
      if (current.released_at) return;
      db.prepare("UPDATE license_assignments SET released_at=CURRENT_TIMESTAMP,released_by=?,release_note=? WHERE id=?")
        .run(user.id, body.note.trim(), id);
      appendLicenseHistory(context, current.license_id, "released", current, requireRecord(db, "license_assignments", id, fail), body.note.trim());
    });
    json(200, { ok: true });
    return true;
  }
  fail(404, "Recurso de licencia no encontrado");
}
