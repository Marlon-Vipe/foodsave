export const businessToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());

export const validDate = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
export const validText = (value, min = 2, max = 120) =>
  typeof value === "string" && value.trim().length >= min && value.length <= max;
export const validAmount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
export const validValue = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12;

export function checkFields(body, required, optional, fail) {
  if (required.some((key) => !Object.hasOwn(body, key)) ||
      Object.keys(body).some((key) => !required.includes(key) && !optional.includes(key)))
    fail(400, "Revisa los campos de la solicitud");
}
export function activeUser(db, id, fail) {
  if (!positiveId(id) || !db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(id))
    fail(400, "Selecciona un usuario activo");
}
export function checkVersion(current, body, fail) {
  if (!positiveId(body.expected_version)) fail(400, "Incluye la versión actual");
  if (current.version !== body.expected_version) fail(409, "El registro cambió. Actualiza la pantalla y vuelve a intentarlo");
}
export function requireRecord(db, table, id, fail) {
  if (!positiveId(id)) fail(400, "Identificador inválido");
  const record = db.prepare("SELECT * FROM " + table + " WHERE id=?").get(id);
  if (!record) fail(404, "Registro no encontrado");
  return record;
}
export function exportCSV(res, audit, user, ip, name, rows) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  audit(user.id, name.includes("licencias") ? "license.report" : "business.report", name, ip);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="foodsave-' + name + '.csv"');
  res.end("\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n");
}


export function businessOwners(db) {
  return db.prepare("SELECT u.id,u.name,r.permissions FROM users u JOIN roles r ON r.id=u.role WHERE u.active=1 ORDER BY u.name").all()
    .filter((row) => JSON.parse(row.permissions).includes("business.manage"))
    .map(({ id, name }) => ({ id, name }));
}
export function checkOwner(db, id, fail) {
  if (!positiveId(id) || !businessOwners(db).some((row) => row.id === id))
    fail(400, "Selecciona un responsable activo con permiso de gestión de negocios");
}
export function appendBusinessHistory(context, businessId, action, before, after) {
  const { db, user, audit, req } = context;
  db.prepare("INSERT INTO business_history(business_id,actor_id,action,before_json,after_json) VALUES (?,?,?,?,?)")
    .run(businessId, user.id, action, before ? JSON.stringify(before) : null, JSON.stringify(after));
  audit(user.id, "business." + action, businessId, req.socket.remoteAddress);
}
export function appendLicenseHistory(context, licenseId, action, before, after, note = "") {
  const { db, user, audit, req } = context;
  db.prepare("INSERT INTO license_history(license_id,actor_id,action,before_json,after_json,note) VALUES (?,?,?,?,?,?)")
    .run(licenseId, user.id, action, before ? JSON.stringify(before) : null, JSON.stringify(after), note);
  audit(user.id, "license." + action, licenseId, req.socket.remoteAddress);
}
export function validateFilters(url, allowed, fail) {
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) fail(400, "Filtros inválidos");
}
