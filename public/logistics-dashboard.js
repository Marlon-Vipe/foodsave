export function createLogisticsDashboard({ root, api, has, escape, notify, onAction, onRefresh }) {
  root.innerHTML = `
    <section class="logistics-overview" aria-labelledby="logistics-overview-title">
      <div class="panel-head">
        <div><h2 id="logistics-overview-title">Control logístico</h2><p id="dashboard-date"></p></div>
        <button type="button" class="secondary" id="dashboard-refresh">Actualizar panel</button>
      </div>
      <div id="dashboard-summary" class="logistics-summary"></div>
    </section>
    <div class="logistics-dashboard-grid">
      <section class="panel" aria-labelledby="logistics-alerts-title">
        <div class="panel-head"><h2 id="logistics-alerts-title">Necesitan atención</h2><span id="dashboard-alert-count"></span></div>
        <label for="dashboard-alert-filter">Filtrar alertas</label>
        <select id="dashboard-alert-filter">
          <option value="">Todas las alertas</option><option value="expired">Lotes vencidos</option>
          <option value="expiring">Vencen en 7 días</option><option value="low">Existencias bajas</option>
        </select>
        <div id="dashboard-alerts" class="logistics-alert-list"></div>
      </section>
      <section class="panel" aria-labelledby="logistics-fefo-title">
        <h2 id="logistics-fefo-title">Próximas salidas</h2>
        <p>Primero vence, primero sale (FEFO). La prioridad se calcula entre lotes del mismo alimento y categoría.</p>
        <div class="logistics-priority-list" id="dashboard-priority"></div>
      </section>
    </div>
    <details class="panel logistics-minimums">
      <summary>Mínimos por alimento</summary>
      <p>Se suman las unidades disponibles de todos los lotes del mismo nombre y categoría. Un mínimo de 0 desactiva la alerta.</p>
      <div class="table-wrap"><table><thead><tr><th>Alimento</th><th>Disponible</th><th>Mínimo</th><th>Acción</th></tr></thead><tbody id="dashboard-minimums"></tbody></table></div>
    </details>
    <div class="error" role="alert" id="dashboard-error" hidden></div>
  `;
  const el = (selector) => root.querySelector(selector);
  const filter = el("#dashboard-alert-filter");
  const error = el("#dashboard-error");
  let data = null;
  let requestId = 0;
  const canMove = has("logistics.move");
  const canDiscard = has("operations.read") && has("operations.manage");
  const canRegister = has("inventory.manage");
  const actionButton = (label, type, id, className = "secondary") =>
    `<button type="button" class="${className}" data-dashboard-action="${type}" data-food-id="${id}">${label}</button>`;
  const dayLabel = (days) => {
    if (days < 0) return `Venció hace ${Math.abs(days)} ${days === -1 ? "día" : "días"}`;
    if (days === 0) return "Vence hoy";
    return `Vence en ${days} ${days === 1 ? "día" : "días"}`;
  };

  function drawAlerts() {
    const alerts = data.alerts.filter((alert) => !filter.value || alert.kind === filter.value);
    el("#dashboard-alert-count").textContent = `${alerts.length} ${alerts.length === 1 ? "alerta" : "alertas"}`;
    el("#dashboard-alerts").innerHTML = alerts.map((alert) => {
      const low = alert.kind === "low";
      let action = "";
      let note = low
        ? `${alert.available} disponibles · mínimo ${alert.minimum} · faltan ${alert.missing}`
        : `Lote #${alert.id} · ${alert.quantity} unidades · ${dayLabel(alert.days_remaining)}`;
      if (low && canMove && alert.replenishment_lot_id)
        action = actionButton("Registrar entrada", "entry", alert.replenishment_lot_id);
      else if (low && canRegister)
        action = actionButton("Registrar lote de reposición", "new-lot", alert.food_id);
      else if (!low && alert.kind === "expired" && canDiscard)
        action = actionButton("Preparar descarte", "discard", alert.id, "danger");
      else if (!low && alert.kind === "expiring" && canMove)
        action = actionButton("Registrar salida", "exit", alert.id);
      const label = { expired: "Vencido", expiring: "Por vencer", low: "Existencias bajas" }[alert.kind];
      return `<article class="logistics-alert logistics-alert-${alert.kind}">
        <div><span class="logistics-status">${label}</span>
        <h3>${escape(alert.name)}</h3><small>${escape(alert.category)}</small><p>${note}</p></div>${action}
      </article>`;
    }).join("") || '<p class="empty">No hay alertas para este filtro.</p>';
  }

  function draw() {
    el("#dashboard-date").textContent = `Hoy, ${data.date} · Santo Domingo`;
    const summary = data.summary;
    el("#dashboard-summary").innerHTML = [
      ["Unidades disponibles", summary.available_units, `${summary.physical_units} unidades físicas`, ""],
      ["Lotes por vencer", summary.expiring_lots, "Desde hoy hasta los próximos 7 días", "warning"],
      ["Lotes vencidos", summary.expired_lots, "Pendientes de descarte", "danger"],
      ["Entradas del día", summary.entry_units_today, `${summary.entry_movements_today} movimientos · unidades`, ""],
      ["Salidas del día", summary.exit_units_today, `${summary.exit_movements_today} movimientos · unidades`, ""],
    ].map(([title, value, note, tone]) => `<div class="logistics-metric ${tone}"><small>${title}</small><strong>${value}</strong><small>${note}</small></div>`).join("");
    drawAlerts();
    el("#dashboard-priority").innerHTML = data.priority.map((lot) =>
      `<article class="logistics-priority-row">
        <div><h3>${escape(lot.name)}</h3><small>${escape(lot.category)} · lote #${lot.id}</small>
        <p>${lot.expires} · ${lot.quantity} unidades</p>
        <span class="logistics-status ${lot.product_priority === 1 ? "first" : ""}">${lot.product_priority === 1 ? "Primera salida para este alimento" : "Prioridad " + lot.product_priority + " para este alimento"}</span></div>
        ${canMove ? actionButton("Registrar salida", "exit", lot.id) : ""}
      </article>`).join("") || '<p class="empty">No hay lotes disponibles para salida.</p>';
    el("#dashboard-minimums").innerHTML = data.products.map((product) =>
      `<tr><td><strong>${escape(product.name)}</strong><small>${escape(product.category)}</small></td>
      <td>${product.available} u.</td>
      <td>${canMove ? `<form id="minimum-form-${product.food_id}" data-minimum-form="${product.food_id}">
        <input type="number" name="minimum" aria-label="Mínimo de ${escape(product.name)} · ${escape(product.category)}" value="${product.minimum}" min="0" max="1000000" step="1" required>
        <input type="hidden" name="expected_version" value="${product.version}"></form>` : product.minimum}</td>
      <td>${canMove ? `<button type="submit" class="secondary" form="minimum-form-${product.food_id}">Guardar mínimo</button>` : "Consulta"}</td></tr>`
    ).join("") || '<tr><td colspan="4" class="empty">Registra un alimento para configurar su mínimo.</td></tr>';
  }

  async function refresh() {
    const current = ++requestId;
    const next = await api("logistics/dashboard");
    if (current !== requestId || !root.isConnected) return;
    data = next;
    error.hidden = true;
    draw();
  }
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-dashboard-action]");
    if (!button) return;
    error.hidden = true;
    try {
      await onAction(button.dataset.dashboardAction, Number(button.dataset.foodId));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-minimum-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity() || form.dataset.pending) return;
    form.dataset.pending = "true";
    const button = root.querySelector(`button[form="${form.id}"]`);
    button.disabled = true;
    error.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await api("logistics/minimums", "PUT", {
        food_id: Number(form.dataset.minimumForm),
        minimum: Number(values.minimum),
        expected_version: Number(values.expected_version),
      });
      notify("Mínimo actualizado.");
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      delete form.dataset.pending;
      button.disabled = false;
    }
  });
  filter.onchange = () => { if (data) drawAlerts(); };
  el("#dashboard-refresh").onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await onRefresh(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
    finally { button.disabled = false; }
  };
  return { refresh };
}
