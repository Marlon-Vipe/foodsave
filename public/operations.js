const states = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};
const types = { consumo: "Consumo", descarte: "Descarte" };
const fieldLabels = {
  title: "Título",
  type: "Tipo",
  food_id: "Alimento",
  quantity: "Cantidad",
  responsible_id: "Responsable",
  scheduled_date: "Fecha prevista",
  status: "Estado",
  notes: "Notas",
  close_note: "Observación de cierre",
  closed_at: "Cerrada el",
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const dateTime = (value) =>
  value
    ? new Date(value.replace(" ", "T") + "Z").toLocaleString("es-DO", {
        timeZone: "America/Santo_Domingo",
      })
    : "—";
let filters = {},
  selected = null;
export async function renderOperations({ main, api, has, notify }) {
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  const [{ operations }, options] = await Promise.all([
    api("operations" + (query ? "?" + query : "")),
    api("operations/options"),
  ]);
  const people = [
    ...new Map(
      [...options.responsibles, ...options.owners].map((u) => [u.id, u]),
    ).values(),
  ];
  const refresh = () =>
    renderOperations({ main, api, has, notify }).catch((e) =>
      notify(e.message),
    );
  const ownerOptions = (value, all = false) =>
    `${all ? '<option value="">Todos los responsables</option>' : '<option value="">Selecciona un responsable</option>'}${(all ? people : options.owners).map((u) => `<option value="${u.id}" ${String(u.id) === String(value) ? "selected" : ""}>${escape(u.name)}</option>`).join("")}`;
  const fields = (operation = {}, prefix = "new") =>
    `<div class="operations-form-grid"><div class="wide"><label for="${prefix}-title">${prefix === "edit" ? "Editar título" : "Título de la operación"}</label><input id="${prefix}-title" name="title" value="${escape(operation.title || "")}" minlength="3" maxlength="120" required placeholder="Ej. Consumo del almuerzo"></div><div><label for="${prefix}-type">${prefix === "edit" ? "Editar tipo" : "Tipo de operación"}</label><select id="${prefix}-type" name="type">${Object.entries(
      types,
    )
      .map(
        ([key, label]) =>
          `<option value="${key}" ${operation.type === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><div><label for="${prefix}-food">${prefix === "edit" ? "Editar alimento" : "Alimento de la operación"}</label><select id="${prefix}-food" name="food_id" required><option value="">Selecciona un alimento</option>${options.foods.map((f) => `<option value="${f.id}" ${operation.food_id === f.id ? "selected" : ""}>${escape(f.name)} · ${f.quantity} ud. · vence ${f.expires}</option>`).join("")}</select></div><div><label for="${prefix}-quantity">${prefix === "edit" ? "Editar cantidad" : "Cantidad de la operación"}</label><input id="${prefix}-quantity" name="quantity" type="number" min="1" max="10000" value="${operation.quantity || 1}" required></div><div><label for="${prefix}-owner">${prefix === "edit" ? "Editar responsable" : "Responsable de la operación"}</label><select id="${prefix}-owner" name="responsible_id" required>${ownerOptions(operation.responsible_id)}</select></div><div><label for="${prefix}-date">${prefix === "edit" ? "Editar fecha prevista" : "Fecha prevista de la operación"}</label><input id="${prefix}-date" name="scheduled_date" type="date" value="${operation.scheduled_date || new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" })}" required></div><div class="wide"><label for="${prefix}-notes">${prefix === "edit" ? "Editar notas" : "Notas de la operación"}</label><textarea id="${prefix}-notes" name="notes" maxlength="1000" rows="2">${escape(operation.notes || "")}</textarea></div></div>`;
  main.innerHTML = `<div class="page-heading"><div><div class="eyebrow">FoodSave / Gestión operativa</div><h1>Operaciones</h1><p>Planifica el consumo y el descarte de tus alimentos.</p></div><button id="refresh-operations" class="secondary">Actualizar</button></div><div class="operation-summary">${Object.entries(
    states,
  )
    .map(
      ([key, label]) =>
        `<div class="stat"><small>${label.toUpperCase()}</small><strong>${operations.filter((o) => o.status === key).length}</strong><small>Con los filtros actuales</small></div>`,
    )
    .join(
      "",
    )}</div><section class="panel"><form id="operation-filters" class="operation-filters"><div><label for="filter-status">Estado</label><select id="filter-status" name="status"><option value="">Todos los estados</option>${Object.entries(
    states,
  )
    .map(
      ([key, label]) =>
        `<option value="${key}" ${filters.status === key ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></div><div><label for="filter-from">Fecha prevista desde</label><input id="filter-from" name="from" type="date" value="${filters.from || ""}"></div><div><label for="filter-to">Fecha prevista hasta</label><input id="filter-to" name="to" type="date" value="${filters.to || ""}"></div><div><label for="filter-owner">Responsable</label><select id="filter-owner" name="responsible_id">${ownerOptions(filters.responsible_id, true)}</select></div><button type="submit">Filtrar operaciones</button><button type="button" id="clear-filters" class="secondary">Limpiar</button></form><div class="operation-report-actions">${has("operations.report") ? `<a class="button" href="/api/operations/export.csv${query ? "?" + query : ""}">Descargar operaciones CSV</a><a class="button secondary-link" href="/api/operations/print${query ? "?" + query : ""}" target="_blank" rel="noopener">Imprimir reporte de operaciones</a>` : ""}<small>${operations.length} operaciones encontradas · El reporte utiliza estos filtros.</small></div><div class="table-wrap"><table><thead><tr><th>Operación</th><th>Alimento / cantidad</th><th>Responsable</th><th>Fecha prevista</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${operations.map((o) => `<tr><td><strong>#${o.id} · ${escape(o.title)}</strong><small>${types[o.type]}</small></td><td>${escape(o.food_name)}<small>${o.quantity} unidades</small></td><td>${escape(o.responsible_name)}</td><td>${o.scheduled_date}</td><td><span class="badge ${o.status === "cancelada" ? "inactive" : ""}">${states[o.status]}</span></td><td><button class="secondary" data-operation="${o.id}">Ver operación</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No hay operaciones para los filtros seleccionados.</td></tr>'}</tbody></table></div></section><div id="operation-detail"></div>${has("operations.manage") ? `<section class="panel"><h2>Nueva operación</h2><p>El inventario se descuenta al cerrar la operación. Las operaciones pendientes no reservan existencias.</p><form id="create-operation">${fields()}<button type="submit" class="auth-submit">Crear operación</button></form></section>` : ""}`;
  main.querySelector("#refresh-operations").onclick = refresh;
  main.querySelector("#operation-filters").onsubmit = (e) => {
    e.preventDefault();
    filters = Object.fromEntries(new FormData(e.currentTarget));
    selected = null;
    refresh();
  };
  main.querySelector("#clear-filters").onclick = () => {
    filters = {};
    selected = null;
    refresh();
  };
  const dataOf = (form) => {
    const data = Object.fromEntries(new FormData(form));
    for (const k of ["food_id", "quantity", "responsible_id"])
      data[k] = Number(data[k]);
    return data;
  };
  const create = main.querySelector("#create-operation");
  if (create)
    create.onsubmit = async (e) => {
      e.preventDefault();
      const button = create.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const data = await api("operations", "POST", dataOf(create));
        selected = data.operation.id;
        notify("Operación creada.");
        await refresh();
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    };
  const show = async (id) => {
    const { operation: o, history } = await api("operations/" + id);
    selected = id;
    const terminal = ["cerrada", "cancelada"].includes(o.status);
    const panel = main.querySelector("#operation-detail");
    panel.innerHTML = `<section class="panel operation-detail"><div class="panel-head"><h2>Operación #${o.id} · ${escape(o.title)}</h2><span class="badge">${states[o.status]}</span></div><p>${types[o.type]} · ${escape(o.food_name)} · ${o.quantity} unidades · Responsable: ${escape(o.responsible_name)}</p><small>Creada por ${escape(o.creator_name)} el ${dateTime(o.created_at)}${o.closed_at ? " · Cerrada: " + dateTime(o.closed_at) : ""}</small>${o.notes ? `<p class="operation-notes">${escape(o.notes)}</p>` : ""}${o.close_note ? `<div class="callout">${o.status === "cancelada" ? "Motivo de cancelación" : "Observación de cierre"}: ${escape(o.close_note)}</div>` : ""}${!terminal && has("operations.manage") ? `<details class="operation-editor"><summary>Editar operación</summary><form id="edit-operation">${fields(o, "edit")}<button type="submit" class="auth-submit">Guardar cambios de operación</button></form></details>` : ""}${!terminal ? `<div class="operation-controls">${has("operations.manage") && o.status === "pendiente" ? '<button type="button" data-action="start">Iniciar operación</button>' : ""}${has("operations.manage") || (has("operations.close") && o.status === "en_proceso") ? '<label for="action-note">Observación de cierre o cancelación</label><textarea id="action-note" minlength="5" maxlength="1000" rows="2" placeholder="Describe el resultado o el motivo…"></textarea>' : ""}<div class="row-actions">${has("operations.close") && o.status === "en_proceso" ? '<button type="button" data-action="close">Cerrar operación</button>' : ""}${has("operations.manage") ? '<button type="button" class="danger" data-action="cancel">Cancelar operación</button>' : ""}</div></div>` : '<p class="callout">Esta operación es definitiva. Su historial se conserva para consulta.</p>'}<h3 class="history-heading">Historial de cambios</h3><ol class="operation-history">${history
      .map((h) => {
        const changed = Object.keys(fieldLabels).filter(
          (k) => (h.before?.[k] ?? null) !== (h.after[k] ?? null),
        );
        const value = (key, val) =>
          key === "status"
            ? states[val] || val
            : key === "type"
              ? types[val] || val
              : key === "responsible_id"
                ? people.find((u) => u.id === val)?.name || "#" + val
                : key === "food_id"
                  ? options.foods.find((f) => f.id === val)?.name || "#" + val
                  : val;
        return `<li><strong>${{ created: "Creación", updated: "Actualización", started: "Inicio", closed: "Cierre", cancelled: "Cancelación" }[h.action]}</strong><small>${escape(h.actor_name)} · ${dateTime(h.created_at)}</small>${h.note ? `<p>${escape(h.note)}</p>` : ""}<details><summary>Ver cambios registrados</summary><ul>${changed.map((k) => `<li>${fieldLabels[k]}: ${h.before ? escape(value(k, h.before[k]) ?? "—") + " → " : ""}${escape(value(k, h.after[k]) ?? "—")}</li>`).join("")}</ul></details></li>`;
      })
      .join("")}</ol></section>`;
    const edit = panel.querySelector("#edit-operation");
    if (edit)
      edit.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api("operations/" + id, "PATCH", {
            ...dataOf(edit),
            expected_version: o.version,
          });
          notify("Operación actualizada.");
          await refresh();
        } catch (error) {
          notify(error.message);
        }
      };
    panel.querySelectorAll("[data-action]").forEach(
      (button) =>
        (button.onclick = async () => {
          button.disabled = true;
          try {
            await api(
              "operations/" + id + "/" + button.dataset.action,
              "POST",
              {
                expected_version: o.version,
                ...(button.dataset.action === "start"
                  ? {}
                  : { note: panel.querySelector("#action-note").value }),
              },
            );
            notify(
              {
                start: "Operación en proceso.",
                close: "Operación cerrada. Inventario actualizado.",
                cancel: "Operación cancelada.",
              }[button.dataset.action],
            );
            await refresh();
          } catch (error) {
            notify(error.message);
          } finally {
            button.disabled = false;
          }
        }),
    );
  };
  main
    .querySelectorAll("[data-operation]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          show(Number(button.dataset.operation)).catch((e) =>
            notify(e.message),
          )),
    );
  if (selected) await show(selected);
}
