export function collectReport(db, user, generatedAt = new Date()) {
  const foods = db
    .prepare(
      "SELECT id,name,category,quantity,expires,status FROM foods ORDER BY status,expires,id",
    )
    .all();
  const count = (status) => foods.filter((f) => f.status === status).length;
  const consumed = count("consumed"),
    wasted = count("wasted");
  return {
    generatedAt: generatedAt.toISOString(),
    preparedBy: user.name,
    foods,
    summary: {
      total: foods.length,
      available: count("available"),
      consumed,
      wasted,
      utilization:
        consumed + wasted
          ? Math.round((100 * consumed) / (consumed + wasted))
          : 0,
    },
  };
}
const statusLabels = {
  available: "En inventario",
  consumed: "Aprovechado",
  wasted: "Descartado",
};
export function reportCSV(report) {
  const cell = (value) => {
    let text = String(value ?? "");
    // Prevent spreadsheet formula execution in user supplied fields.
    if (/^\s*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [
    ["FOODSAVE · REPORTE DE ALIMENTOS"],
    [
      "Generado",
      new Date(report.generatedAt).toLocaleString("es-DO", {
        timeZone: "America/Santo_Domingo",
      }),
    ],
    ["Preparado por", report.preparedBy],
    [],
    ["Indicador", "Registros"],
    ["Total de alimentos", report.summary.total],
    ["En inventario", report.summary.available],
    ["Aprovechados", report.summary.consumed],
    ["Descartados", report.summary.wasted],
    [
      "Aprovechamiento sobre alimentos procesados",
      report.summary.utilization + "%",
    ],
    [],
    [
      "ID",
      "Alimento",
      "Categoría",
      "Cantidad (unidades)",
      "Fecha de vencimiento",
      "Estado",
    ],
    ...report.foods.map((f) => [
      f.id,
      f.name,
      f.category,
      f.quantity,
      f.expires,
      statusLabels[f.status] ?? f.status,
    ]),
  ];
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}
export function reportHTML(report) {
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const date = new Date(report.generatedAt).toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
  });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte FoodSave</title><link rel="stylesheet" href="/report.css"><script src="/report.js" defer></script></head><body><div class="toolbar"><button id="print-report">Imprimir / guardar como PDF</button><a href="/">Volver a FoodSave</a></div><main><header><span class="brand">foodsave.</span><h1>Reporte de alimentos</h1><p>Generado: ${escape(date)} · Hora de Santo Domingo</p><p>Preparado por: ${escape(report.preparedBy)}</p></header><section class="summary"><div>Total<strong>${report.summary.total}</strong></div><div>En inventario<strong>${report.summary.available}</strong></div><div>Aprovechados<strong>${report.summary.consumed}</strong></div><div>Descartados<strong>${report.summary.wasted}</strong></div><div>Aprovechamiento<strong>${report.summary.utilization}%</strong></div></section><p class="note">Los indicadores cuentan registros de alimentos. El porcentaje considera los alimentos consumidos y descartados. El detalle muestra cantidades en unidades y fechas de vencimiento.</p><h2>Inventario e historial completos</h2><table><thead><tr><th>ID</th><th>Alimento</th><th>Categoría</th><th>Cantidad</th><th>Vencimiento</th><th>Estado</th></tr></thead><tbody>${report.foods.map((f) => `<tr><td>${f.id}</td><td>${escape(f.name)}</td><td>${escape(f.category)}</td><td>${f.quantity}</td><td>${escape(f.expires)}</td><td>${escape(statusLabels[f.status] ?? f.status)}</td></tr>`).join("") || '<tr><td colspan="6">No hay alimentos registrados.</td></tr>'}</tbody></table><footer>FoodSave · Reporte generado con los datos disponibles al momento de su emisión.</footer></main></body></html>`;
}
