export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
export const titles = { draft: "Borrador", active: "Activo", completed: "Completado", archived: "Archivado", planned: "Planificado", initiative: "Iniciativa", product: "Producto", service: "Servicio", economic: "Económico", social: "Social", environmental: "Ambiental", valid: "Vigente", scheduled: "Futura", expired: "Vencida", disabled: "Deshabilitada", expiring: "Próxima a vencer", equipment: "Equipo", area: "Área" };
export const title = (value) => titles[value] ?? value;
export const options = (rows, selected, label = (r) => r.name) => rows.map((row) => `<option value="${esc(row.id)}" ${String(row.id) === String(selected) ? "selected" : ""}>${esc(label(row))}</option>`).join("");
export const choices = (values, selected) => values.map((id) => `<option value="${id}" ${id === selected ? "selected" : ""}>${title(id)}</option>`).join("");
export function field(name, label, value = "", type = "text", attrs = "") {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs} required></label>`;
}
export const select = (name, label, content) => `<label>${esc(label)}<select name="${name}">${content}</select></label>`;
export const submit = (label) => `<div class="business-form-error" role="alert" hidden></div><button type="submit">${esc(label)}</button>`;
export function bindForm(main, selector, action, refresh, notify) {
  const form = main.querySelector(selector);
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]'), error = form.querySelector('[role="alert"]');
    button.disabled = true; error.hidden = true;
    try {
      await action(Object.fromEntries(new FormData(form)), form);
      await refresh(); notify("Cambios guardados.");
    } catch (e) { error.textContent = e.message; error.hidden = false; button.disabled = false; }
  };
}
export function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Usa un importe positivo con hasta dos decimales.");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 1e12) throw new Error("Importe fuera de rango.");
  return result;
}
export const currency = (amount, code) => new Intl.NumberFormat("es-DO", { style: "currency", currency: code }).format(amount / 100);
export const badge = (value) => `<span class="business-badge state-${value}">${esc(title(value))}</span>`;
const actions = { created: "Registro creado", updated: "Datos actualizados", "status.changed": "Estado actualizado", "project.created": "Proyecto creado", "project.updated": "Proyecto actualizado", "indicator.created": "Indicador definido", "measurement.recorded": "Medición registrada", assigned: "Licencia asignada", released: "Asignación liberada" };
export const history = (rows) => `<details class="panel"><summary>Historial de cambios · ${rows.length}</summary><ol class="business-history">${rows.map((r) => `<li><strong>${esc(actions[r.action] ?? r.action)}</strong> · ${esc(r.actor_name)}<small>${esc(r.created_at)} UTC ${esc(r.note ?? "")}</small><details><summary>Ver datos del cambio</summary><pre>${esc(JSON.stringify({ antes: r.before_json ? JSON.parse(r.before_json) : null, despues: JSON.parse(r.after_json) }, null, 2))}</pre></details></li>`).join("") || "<li>Sin cambios.</li>"}</ol></details>`;
