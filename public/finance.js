export const money = (cents) => new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(cents / 100);
export function toCents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error("Introduce un importe con un máximo de dos decimales.");
  const [whole, fraction = ""] = String(value).split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100000000) throw new Error("El importe máximo es RD$ 1 000 000.");
  return cents;
}
export function costFields(prefix) {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
  return `<div class="food-form-grid"><div><label for="${prefix}-cost">Costo unitario (RD$)</label>
    <input id="${prefix}-cost" name="unit_cost" type="number" min="0" max="1000000" step="0.01" placeholder="Opcional · costo por unidad"></div>
    <div><label for="${prefix}-purchase">Fecha de compra</label><input id="${prefix}-purchase" name="purchased_on" type="date" value="${date}" max="${date}"></div></div>`;
}
export function readCostFields(data) {
  if (!Object.hasOwn(data, "unit_cost")) return;
  if (data.unit_cost !== "") data.unit_cost_cents = toCents(data.unit_cost);
  delete data.unit_cost;
  if (!data.purchased_on) delete data.purchased_on;
}

export async function renderFinance({ main, api, has, notify, escape, heading, openPage, month }) {
  const selected = month ?? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date()).slice(0, 7);
  const data = await api("finance/summary?month=" + selected);
  const s = data.summary;
  const canManage = has("finance.manage");
  const refresh = () => renderFinance({ main, api, has, notify, escape, heading, openPage, month: selected });
  const missing = data.lots.filter((lot) => lot.unit_cost_cents === null && lot.status === "available");
  const status = { purchase: "Compra", consumption: "Consumo", waste: "Descarte", distribution: "Distribución" };
  const budgetKnown = data.budget.amount_cents !== null;
  const funds = (data.budget.amount_cents ?? 0) + s.aid_cents;
  main.innerHTML = heading("FoodSave / Economía", "Finanzas", "Conoce tus gastos, cuida tu presupuesto y reduce las pérdidas de alimentos.") +
    `<div class="finance-toolbar"><div><label for="finance-month">Mes de gastos y ayudas</label><input id="finance-month" type="month" value="${selected}"></div>
      ${has("finance.report") ? `<a class="button" href="/api/finance/export.csv?month=${selected}">Descargar finanzas CSV</a>` : ""}</div>
    <div class="finance-metrics">
      ${[["Gasto del mes", s.spending_cents, "Compras con costo + gastos adicionales"],
        ["Ayudas recibidas", s.aid_cents, "Donaciones, apoyos y subsidios registrados"],
        ["En riesgo de perder", s.risk_cents, "Valor actual que vence en 7 días"],
        ["Pérdida registrada", s.waste_cents, "Costo de descartes realizados en el mes"]].map(([label, value, note]) =>
        `<article class="stat"><small>${label}</small><strong>${money(value)}</strong><small>${note}</small></article>`).join("")}
    </div>
    ${s.unpriced_lots || s.unpriced_movements ? `<div class="callout">${s.unpriced_lots} lotes actuales y ${s.unpriced_movements} movimientos del mes sin costo registrado. Los importes mostrados son parciales.</div>` : ""}
    <div class="finance-grid">
      <section class="panel"><h2>Presupuesto y ahorro</h2>
        <p>Presupuesto mensual: <strong>${budgetKnown ? money(data.budget.amount_cents) : "Sin configurar"}</strong></p>
        <p>Disponible: <strong class="${s.remaining_cents < 0 ? "finance-negative" : ""}">${budgetKnown ? money(s.remaining_cents) : "Configura tu presupuesto"}</strong></p>
        ${budgetKnown ? `<progress class="finance-progress" max="${Math.max(funds, 1)}" value="${Math.min(s.spending_cents, Math.max(funds, 1))}" aria-label="Presupuesto utilizado"></progress>` : ""}
        <small>Disponible = presupuesto + ayudas recibidas − gastos registrados.</small>
        <p>Gasto cubierto por ti: <strong>${money(s.out_of_pocket_cents)}</strong></p>
        ${s.remaining_cents < 0 ? '<p class="error">Tus gastos superan el presupuesto y las ayudas registradas.</p>' : ""}
        ${canManage ? `<form id="finance-budget"><label for="budget-amount">Presupuesto mensual (RD$)</label><input id="budget-amount" name="amount" type="number" min="0" max="1000000" step="0.01" value="${budgetKnown ? (data.budget.amount_cents / 100).toFixed(2) : ""}" required><div role="alert" hidden></div><button type="submit">Guardar presupuesto</button></form>` : ""}
      </section>
      <section class="panel"><h2>Valor de tus alimentos</h2>
        <p>Inventario con costo: <strong>${money(s.inventory_value_cents)}</strong></p>
        <p>Valor en lotes vencidos: <strong>${money(s.expired_value_cents)}</strong></p>
        <p>Si no utilizas los lotes que vencen en los próximos siete días, podrías perder ${money(s.risk_cents)} adicionales.</p>
        <small>El riesgo y el inventario muestran las existencias actuales, independientemente del mes seleccionado. Los precios usan el costo registrado por lote.</small>
        ${has("logistics.read") ? '<button class="secondary finance-link" type="button" id="finance-logistics">Revisar prioridades en Logística</button>' : ""}
        ${has("ai.use") ? '<button type="button" id="finance-advice" class="finance-link">Pedir sugerencias de ahorro a IA</button><small>OpenAI recibe un resumen de gastos y alimentos próximos a vencer para generar sugerencias.</small><div id="finance-ai-result" aria-live="polite"></div>' : ""}
      </section>
    </div>
    ${canManage ? `<div class="finance-grid"><form class="panel" id="finance-record"><h2>Registrar gasto o ayuda</h2>
      <label for="economic-kind">Tipo de registro</label><select id="economic-kind" name="kind"><option value="expense">Gasto adicional</option><option value="aid">Ayuda, donación o subsidio recibido</option></select>
      <label for="economic-description">Descripción o procedencia</label><input id="economic-description" name="description" minlength="2" maxlength="200" required placeholder="Ej. Transporte de compra o donación recibida">
      <div class="food-form-grid"><div><label for="economic-amount">Importe (RD$)</label><input id="economic-amount" name="amount" type="number" min="0.01" max="1000000" step="0.01" required></div>
      <div><label for="economic-date">Fecha del registro</label><input id="economic-date" name="booked_on" type="date" value="${data.date}" max="${data.date}" required></div></div>
      <div role="alert" hidden></div><button type="submit">Guardar registro económico</button>
      <small>Registra únicamente importes ya recibidos o gastados.</small></form>
      <form class="panel" id="finance-cost"><h2>Completar costos pendientes</h2><p>Permite valorar las existencias actuales. Los movimientos anteriores conservan su estado sin costo.</p>
        <label for="cost-food">Lote sin costo</label><select id="cost-food" name="food_id" required><option value="">Selecciona un lote</option>${missing.map((lot) =>
        `<option value="${lot.id}">${escape(lot.name)} · #${lot.id} · ${lot.quantity} unidades</option>`).join("")}</select>
        <label for="cost-unit">Costo por unidad (RD$)</label><input id="cost-unit" name="amount" type="number" min="0" max="1000000" step="0.01" required>
        <div role="alert" hidden></div><button type="submit" ${missing.length ? "" : "disabled"}>Guardar costo del lote</button>
      </form></div>` : ""}
    <section class="panel"><h2>Gastos y ayudas del mes</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Unidades</th><th>Importe</th></tr></thead><tbody>
      ${data.movements.map((row) => `<tr><td>${escape(row.booked_on ?? row.created_at.slice(0, 10))}</td><td>${status[row.kind] ?? "Sin costo"}</td><td>${escape(row.name)}</td><td>${row.quantity}</td><td>${row.total_cents === null ? "Pendiente" : money(row.total_cents)}</td></tr>`).join("")}
      ${data.economic.map((row) => `<tr><td>${row.booked_on}</td><td>${row.kind === "aid" ? "Ayuda recibida" : "Gasto adicional"}</td><td>${escape(row.description)}</td><td>—</td><td>${money(row.amount_cents)}</td></tr>`).join("") ||
        (data.movements.length ? "" : '<tr><td colspan="5" class="empty">No hay movimientos en este mes.</td></tr>')}
    </tbody></table></div><small>Las salidas por consumo o distribución muestran su costo; el gasto de compra se cuenta una sola vez.</small></section>`;

  const el = (selector) => main.querySelector(selector);
  el("#finance-month").onchange = async (event) => {
    try { await renderFinance({ main, api, has, notify, escape, heading, openPage, month: event.target.value }); }
    catch (error) { notify(error.message); }
  };
  function submit(selector, save) {
    const form = el(selector);
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("[type=submit]");
      const alert = form.querySelector('[role="alert"]');
      button.disabled = true;
      alert.hidden = true;
      try {
        await save(Object.fromEntries(new FormData(form)));
        notify("Información financiera guardada.");
        await refresh();
      } catch (error) {
        alert.textContent = error.message;
        alert.className = "error";
        alert.hidden = false;
      } finally { button.disabled = false; }
    };
  }
  const requestId = crypto.randomUUID();
  submit("#finance-budget", (values) => api("finance/budget", "PUT", {
    month: selected, amount_cents: toCents(values.amount), expected_version: data.budget.version,
  }));
  submit("#finance-record", (values) => api("finance/records", "POST", {
    kind: values.kind, description: values.description, amount_cents: toCents(values.amount),
    booked_on: values.booked_on, request_id: requestId,
  }));
  submit("#finance-cost", (values) => api("finance/lot-costs", "POST", {
    food_id: Number(values.food_id), unit_cost_cents: toCents(values.amount),
  }));
  if (el("#finance-logistics")) el("#finance-logistics").onclick = () => openPage("logistics");
  const advice = el("#finance-advice");
  if (advice) advice.onclick = async () => {
    advice.disabled = true;
    const target = el("#finance-ai-result");
    target.textContent = "Preparando sugerencias…";
    try {
      const result = await api("finance/advice", "POST", { month: selected });
      target.innerHTML = `<p>${escape(result.summary)}</p><ul>${result.actions.map((action) => `<li>${escape(action)}</li>`).join("")}</ul>`;
    } catch (error) { target.textContent = error.message; }
    finally { advice.disabled = false; }
  };
}
