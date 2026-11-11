const categoryNames = ["Lácteos", "Carnes", "Frutas y verduras", "Panadería", "Congelados", "Otros"];
const typeLabels = { opening: "Saldo inicial", entry: "Entrada", exit: "Salida" };
const sourceLabels = { migration: "Saldo de apertura", inventory: "Inventario", logistics: "Logística", operation: "Operación" };
const statusLabels = { available: "En inventario", distributed: "Agotado por salida", consumed: "Consumido", wasted: "Descartado" };
const stamp = new Intl.DateTimeFormat("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
const lotOptions = (lots, escape) => lots.map((l) =>
  `<option value="${l.id}">${escape(l.name)} · lote #${l.id} · vence ${escape(l.expires)}</option>`).join("");

export async function renderLogistics({ main, api, has, notify, escape, heading }) {
  const canReport = has("logistics.report");
  main.innerHTML = heading("FoodSave / Inventario", "Logística", "Registra lotes, controla las existencias y consulta cada entrada y salida.") +
    `<div class="stats" id="logistics-stats"></div>
    <section class="panel" aria-labelledby="stock-title">
      <div class="panel-head"><h2 id="stock-title">Existencias por lote</h2>${canReport ? '<a class="button" href="/api/logistics/stock.csv">Descargar existencias CSV</a>' : ""}</div>
      <p>La disponibilidad excluye los lotes vencidos o cerrados.</p>
      <div class="table-wrap"><table><thead><tr><th scope="col">Lote y alimento</th><th scope="col">Vencimiento</th><th scope="col">Existencias físicas</th><th scope="col">Disponible para salida</th><th scope="col">Estado</th></tr></thead><tbody id="logistics-stock"></tbody></table></div>
    </section>
    ${has("inventory.manage") ? `<form class="panel" id="logistics-lot-form">
      <h2>Registrar lote</h2><p>La cantidad registrada cuenta como la primera entrada del lote.</p>
      <label for="logistics-name">Nombre del alimento</label><input id="logistics-name" name="name" minlength="2" maxlength="100" required>
      <div class="food-form-grid">
        <div><label for="logistics-category">Categoría</label><select id="logistics-category" name="category">${categoryNames.map((c) => `<option>${c}</option>`).join("")}</select></div>
        <div><label for="logistics-expiry">Fecha de vencimiento</label><input id="logistics-expiry" type="date" name="expires" required></div>
        <div><label for="logistics-opening">Cantidad inicial</label><input id="logistics-opening" name="quantity" type="number" min="1" max="10000" required></div>
      </div><div role="alert" hidden></div><button class="auth-submit" type="submit">Guardar lote</button>
    </form>` : ""}
    ${has("logistics.move") ? `<form class="panel" id="logistics-move-form">
      <h2>Registrar movimiento</h2><p>Usa Salida para entregas o distribución. Registra el descarte de vencidos en Operaciones.</p>
      <label for="logistics-food">Lote del movimiento</label><select id="logistics-food" name="food_id" required></select>
      <p class="callout" id="logistics-balance"></p>
      <div class="food-form-grid">
        <div><label for="logistics-type">Tipo de movimiento</label><select id="logistics-type" name="type"><option value="entry">Entrada</option><option value="exit">Salida</option></select></div>
        <div><label for="logistics-quantity">Unidades del movimiento</label><input id="logistics-quantity" name="quantity" type="number" min="1" max="10000" required></div>
      </div>
      <label for="logistics-reason">Motivo o destino</label><input id="logistics-reason" name="reason" minlength="5" maxlength="300" required placeholder="Ej. Entrega al comedor comunitario">
      <div role="alert" hidden></div><button class="auth-submit" type="submit">Guardar movimiento</button>
    </form>` : ""}
    <section class="panel" aria-labelledby="movement-title">
      <div class="panel-head"><h2 id="movement-title">Historial de movimientos</h2>${canReport ? '<a id="logistics-export" class="button" href="/api/logistics/movements.csv">Descargar movimientos CSV</a>' : ""}</div>
      <form id="logistics-filters">
        <div class="food-form-grid">
          <div><label for="history-food">Filtrar por lote</label><select id="history-food" name="food_id"></select></div>
          <div><label for="history-type">Filtrar por tipo</label><select id="history-type" name="type"><option value="">Todos los tipos</option>${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
          <div><label for="history-from">Desde</label><input id="history-from" type="date" name="from"></div>
          <div><label for="history-to">Hasta</label><input id="history-to" type="date" name="to"></div>
        </div>
        <div class="report-actions"><button class="secondary" type="submit">Aplicar filtros</button></div>
        <div role="alert" hidden></div>
      </form>
      <div class="table-wrap"><table><thead><tr><th scope="col">Fecha (Santo Domingo)</th><th scope="col">Lote</th><th scope="col">Movimiento</th><th scope="col">Saldo antes → después</th><th scope="col">Motivo</th><th scope="col">Responsable</th></tr></thead><tbody id="logistics-history"></tbody></table></div>
      <div class="report-actions"><button class="secondary" type="button" id="logistics-more" hidden>Cargar más movimientos</button></div>
    </section>`;
  const el = (s) => main.querySelector(s);
  const filter = el("#logistics-filters");
  const more = el("#logistics-more");
  let lots = [], query = "", cursor = null, historyRequest = 0;
  const message = (form, text = "") => {
    const alert = form.querySelector('[role="alert"]');
    alert.textContent = text;
    alert.className = text ? "error" : "";
    alert.hidden = !text;
  };
  const balance = () => {
    const select = el("#logistics-food");
    if (!select) return;
    const lot = lots.find((item) => item.id === Number(select.value));
    el("#logistics-balance").textContent = lot
      ? `Disponible: ${lot.available} unidades. Capacidad para recibir: ${Math.max(0, 10000 - lot.on_hand)}.`
      : "Selecciona un lote disponible.";
    el("#logistics-move-form [type=submit]").disabled = !lot || el("#logistics-move-form").dataset.pending === "true";
  };
  async function loadStock(preferredLot) {
    ({ lots } = await api("logistics/stock"));
    const onHand = lots.reduce((sum, l) => sum + l.on_hand, 0);
    const available = lots.reduce((sum, l) => sum + l.available, 0);
    el("#logistics-stats").innerHTML = `<div class="stat"><small>LOTES REGISTRADOS</small><strong>${lots.length}</strong></div><div class="stat"><small>UNIDADES FÍSICAS</small><strong>${onHand}</strong></div><div class="stat"><small>UNIDADES DISPONIBLES</small><strong>${available}</strong></div>`;
    el("#logistics-stock").innerHTML = lots.map((l) => `<tr><td><strong>${escape(l.name)}</strong><small>#${l.id} · ${escape(l.category)}</small></td><td>${escape(l.expires)}</td><td>${l.on_hand}</td><td>${l.available}</td><td><span class="badge ${l.available ? "" : "inactive"}">${l.on_hand > l.available ? "Vencido" : escape(statusLabels[l.status])}</span></td></tr>`).join("") || '<tr><td colspan="5" class="empty">Aún no hay lotes registrados.</td></tr>';
    const selector = el("#history-food");
    const historyFood = selector.value;
    selector.innerHTML = '<option value="">Todos los lotes</option>' + lotOptions(lots, escape);
    selector.value = historyFood;
    const moveSelect = el("#logistics-food");
    if (moveSelect) {
      const chosen = String(preferredLot ?? moveSelect.value);
      moveSelect.innerHTML = '<option value="">Selecciona un lote</option>' + lotOptions(lots.filter((l) => l.available > 0), escape);
      if ([...moveSelect.options].some((o) => o.value === chosen)) moveSelect.value = chosen;
      balance();
    }
  }
  async function loadHistory({ append = false, nextQuery = query } = {}) {
    const request = ++historyRequest;
    const params = new URLSearchParams(nextQuery);
    if (append && cursor) params.set("before", cursor);
    const result = await api("logistics/movements?" + params);
    if (request !== historyRequest) return;
    const rows = result.movements.map((m) => `<tr><td>${escape(stamp.format(new Date(m.created_at.replace(" ", "T") + "Z")))}</td><td><strong>${escape(m.food_name)}</strong><small>Lote #${m.food_id}</small></td><td><span class="badge">${typeLabels[m.type]}</span><small>${sourceLabels[m.source]}${m.operation_id ? " #" + m.operation_id : ""} · ${m.quantity} u.</small></td><td>${m.before_qty} → ${m.after_qty}</td><td>${escape(m.reason)}</td><td>${escape(m.actor_name ?? "Sistema")}</td></tr>`).join("");
    const table = el("#logistics-history");
    if (append) table.insertAdjacentHTML("beforeend", rows);
    else table.innerHTML = rows || '<tr><td colspan="6" class="empty">No hay movimientos para estos filtros.</td></tr>';
    query = nextQuery;
    cursor = result.next;
    more.hidden = !cursor;
    if (canReport) el("#logistics-export").href = "/api/logistics/movements.csv?" + query;
  }
  function mutation(form, route, success) {
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (form.dataset.pending === "true") return;
      form.dataset.pending = "true";
      message(form);
      const data = Object.fromEntries(new FormData(form));
      data.quantity = Number(data.quantity);
      if (data.food_id !== undefined) data.food_id = Number(data.food_id);
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        const result = await api(route, "POST", data);
        form.reset();
        notify(success);
        await Promise.all([loadStock(data.food_id ?? result.id), loadHistory()]);
      } catch (error) {
        message(form, error.message);
      } finally {
        delete form.dataset.pending;
        button.disabled = false;
        balance();
      }
    };
  }
  const select = el("#logistics-food");
  if (select) select.onchange = balance;
  mutation(el("#logistics-lot-form"), "inventory", "Lote registrado con su entrada inicial.");
  mutation(el("#logistics-move-form"), "logistics/movements", "Movimiento registrado.");
  filter.onsubmit = async (event) => {
    event.preventDefault();
    message(filter);
    const nextQuery = new URLSearchParams([...new FormData(filter)].filter(([, v]) => v)).toString();
    try { await loadHistory({ nextQuery }); }
    catch (error) { message(filter, error.message); }
  };
  more.onclick = async () => {
    more.disabled = true;
    try { await loadHistory({ append: true }); }
    catch (error) { message(filter, error.message); }
    finally { more.disabled = false; }
  };
  await Promise.all([loadStock(), loadHistory()]);
}
