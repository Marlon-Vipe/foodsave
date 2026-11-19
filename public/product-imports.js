import { toCents } from "./finance.js";
const categories = ["Lácteos", "Carnes", "Frutas y verduras", "Panadería", "Congelados", "Otros"];

async function prepareImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024)
    throw new Error("Selecciona una foto PNG, JPEG o WebP de hasta 15 MB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally { image.close(); }
}

export async function renderProductImports({ main, api, has, notify, escape, heading, openPage }) {
  main.innerHTML = heading("FoodSave / Registro", "Escanear productos", "Extrae los productos de una factura, lista o etiqueta y revisa los datos antes de registrarlos.") +
    `<section class="panel"><form id="scan-form"><h2>Leer una imagen</h2><label for="scan-image">Foto de factura o productos</label>
      <input id="scan-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required>
      <p>Al pulsar Analizar imagen, la foto se envía a OpenAI para realizar la lectura OCR y organizar los productos.</p>
      <button type="submit" id="scan-submit">Analizar imagen</button><div role="alert" id="scan-error" hidden></div></form></section>
      <div id="scan-review" aria-live="polite"></div>`;
  const form = main.querySelector("#scan-form");
  const error = main.querySelector("#scan-error");
  const target = main.querySelector("#scan-review");
  let importId = null;
  form.onsubmit = async (event) => {
    event.preventDefault();
    error.hidden = true;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    target.textContent = "Leyendo imagen y organizando productos…";
    try {
      const image = await prepareImage(main.querySelector("#scan-image").files[0]);
      const result = await api("imports/analyze", "POST", { image });
      if (result.status === "committed") {
        target.innerHTML = '<section class="panel"><h2>Esta imagen ya fue registrada</h2><p>Sus productos ya están en Inventario.</p><button type="button" id="scan-existing">Abrir Inventario</button></section>';
        target.querySelector("#scan-existing").onclick = () => openPage("inventory");
        return;
      }
      importId = result.id;
      drawReview(result.draft);
    } catch (err) {
      target.textContent = "";
      error.textContent = err.message;
      error.className = "error";
      error.hidden = false;
    } finally { button.disabled = false; }
  };

  function drawReview(draft) {
    const foreign = draft.currency !== "DOP";
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
    const productRow = (product, index) => `<fieldset class="scan-product" data-scan-product>
      <legend>Producto ${index + 1}</legend><label for="scan-name-${index}">Nombre del producto ${index + 1}</label>
      <input id="scan-name-${index}" name="name" value="${escape(product.name)}" minlength="2" maxlength="100" required>
      <div class="food-form-grid"><div><label for="scan-category-${index}">Categoría del producto ${index + 1}</label>
        <select id="scan-category-${index}" name="category" required><option value="">Selecciona categoría</option>${categories.map((category) => `<option ${category === product.category ? "selected" : ""}>${category}</option>`).join("")}</select></div>
        <div><label for="scan-quantity-${index}">Cantidad del producto ${index + 1}</label><input id="scan-quantity-${index}" name="quantity" type="number" min="1" max="10000" step="1" value="${escape(product.quantity ?? "")}" required></div>
        <div><label for="scan-expiry-${index}">Vencimiento del producto ${index + 1}</label><input id="scan-expiry-${index}" name="expires" type="date" value="${/^\d{4}-\d{2}-\d{2}$/.test(product.expires ?? "") ? product.expires : ""}" required></div>
        ${has("finance.manage") ? `<div><label for="scan-cost-${index}">Costo unitario del producto ${index + 1} (RD$)</label><input id="scan-cost-${index}" name="cost" type="number" min="0" max="1000000" step="0.01" value="${!foreign && Number.isSafeInteger(product.unit_cost_cents) && product.unit_cost_cents >= 0 ? (product.unit_cost_cents / 100).toFixed(2) : ""}" placeholder="Opcional"></div>` : ""}</div>
      ${product.note ? `<p class="callout">${escape(product.note)}</p>` : ""}
      <button class="danger" type="button" data-remove-product>Quitar producto</button>
    </fieldset>`;
    target.innerHTML = `<section class="panel"><h2>Revisar productos detectados</h2>
      ${foreign ? `<div class="callout">Moneda detectada: ${escape(draft.currency ?? "no identificada")}. Introduce los costos en RD$; los precios detectados quedaron pendientes de revisión.</div>` : ""}
      ${draft.warnings.length ? `<div class="callout">${draft.warnings.map(escape).join("<br>")}</div>` : ""}
      <details class="scan-text"><summary>Ver texto leído (OCR)</summary><pre>${escape(draft.raw_text)}</pre></details>
      ${draft.products.length ? `<form id="scan-confirm"><label for="scan-purchased">Fecha de compra de los productos</label>
      <input id="scan-purchased" type="date" value="${/^\d{4}-\d{2}-\d{2}$/.test(draft.purchased_on ?? "") ? draft.purchased_on : date}" max="${date}" required>
      <p>Completa los vencimientos que no aparezcan en la imagen. Las cantidades se registran en unidades enteras.</p>
      ${draft.products.map(productRow).join("")}<div role="alert" id="scan-confirm-error" hidden></div>
      <button type="submit">Registrar productos revisados</button></form>` : '<p>No se detectaron productos. Usa una imagen más clara con los nombres legibles.</p>'}</section>`;
    const confirm = target.querySelector("#scan-confirm");
    if (!confirm) return;
    confirm.querySelectorAll("[data-remove-product]").forEach((button) => {
      button.onclick = () => button.closest("[data-scan-product]").remove();
    });
    confirm.onsubmit = async (event) => {
      event.preventDefault();
      const alert = target.querySelector("#scan-confirm-error");
      const button = confirm.querySelector("[type=submit]");
      button.disabled = true;
      alert.hidden = true;
      try {
        const purchased_on = target.querySelector("#scan-purchased").value;
        const products = [...confirm.querySelectorAll("[data-scan-product]")].map((row) => {
          const value = (name) => row.querySelector(`[name="${name}"]`)?.value;
          return { name: value("name"), category: value("category"), quantity: Number(value("quantity")),
            expires: value("expires"), purchased_on,
            unit_cost_cents: has("finance.manage") && value("cost") !== "" ? toCents(value("cost")) : null };
        });
        if (!products.length) throw new Error("Conserva al menos un producto para registrar.");
        const result = await api("imports/confirm", "POST", { id: importId, products });
        notify(`${result.food_ids.length} productos registrados.`);
        target.innerHTML = `<section class="panel"><h2>Productos registrados</h2><p>${result.food_ids.length} lotes se guardaron con sus entradas de inventario.</p><button type="button" id="scan-done">Ver Inventario</button></section>`;
        target.querySelector("#scan-done").onclick = () => openPage("inventory");
      } catch (err) {
        alert.textContent = err.message;
        alert.className = "error";
        alert.hidden = false;
      } finally { button.disabled = false; }
    };
  }
}
