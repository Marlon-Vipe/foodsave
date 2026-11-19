import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
import { todayDO } from "../finance-store.mjs";

if (!process.env.OPENAI_API_KEY) throw Error("Configura OPENAI_API_KEY para esta prueba en vivo.");
const evidence = "docs/finance/evidence";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
let app;
try {
  const page = await browser.newPage({ viewport: { width: 750, height: 720 } });
  await page.setContent(`<!doctype html><html lang="es"><body style="font:24px Arial;color:#111;background:white;padding:30px">
    <h1 style="font-size:28px">FOODSAVE · FACTURA DE PRUEBA</h1>
    <p>MUESTRA SIMULADA PARA DEMOSTRACIÓN</p><p>Moneda: DOP (RD$)</p><p>Fecha de compra: ${todayDO()}</p><hr>
    <p>Arroz integral · 2 unidades</p><p>Precio unitario: RD$ 50.00 · Total: RD$ 100.00</p><p>Vence: 2099-12-31</p><hr>
    <p>Leche entera · 3 unidades</p><p>Precio unitario: RD$ 80.00 · Total: RD$ 240.00</p><p>Vence: 2099-12-31</p><hr>
    <p><strong>Total: RD$ 340.00</strong></p></body></html>`);
  const photo = await page.screenshot({ path: evidence + "/receipt-demo.png" });
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  app = await createApp({ database: ":memory:", origin });
  const password = randomBytes(18).toString("hex");
  app.db.prepare("INSERT INTO users(name,email,password,role) VALUES ('Prueba de IA','ia@example.test',?,'administrador')")
    .run(await hashPassword(password));
  app.server.listen(port, "127.0.0.1");
  await once(app.server, "listening");
  const request = async (route, method = "GET", body, auth) => {
    const result = await fetch(origin + "/api/" + route, {
      method, headers: { Origin: origin, "Content-Type": "application/json", ...(auth ?? {}) },
      ...(body && { body: JSON.stringify(body) }),
    });
    const data = await result.json();
    if (!result.ok) throw Error(route + ": " + data.error);
    return { result, data };
  };
  const login = await request("login", "POST", { email: "ia@example.test", password });
  const auth = { Cookie: login.result.headers.get("set-cookie").split(";")[0], "X-CSRF-Token": login.data.csrf };
  const analyzed = await request("imports/analyze", "POST", { image: "data:image/png;base64," + photo.toString("base64") }, auth);
  assert.equal(analyzed.data.status, "review");
  assert.equal(analyzed.data.draft.products.length, 2);
  assert.match(analyzed.data.draft.raw_text.toLowerCase(), /arroz/);
  assert.equal(analyzed.data.draft.currency, "DOP");
  const products = analyzed.data.draft.products.map((row) => ({
    name: row.name, category: row.category, quantity: row.quantity, unit_cost_cents: row.unit_cost_cents,
    expires: row.expires, purchased_on: todayDO(),
  }));
  assert.equal(products.reduce((sum, product) => sum + product.quantity * product.unit_cost_cents, 0), 34000);
  const confirmed = await request("imports/confirm", "POST", { id: analyzed.data.id, products }, auth);
  assert.equal(confirmed.data.food_ids.length, 2);
  const summary = await request("finance/summary", "GET", null, auth);
  assert.equal(summary.data.summary.spending_cents, 34000);
  const advice = await request("finance/advice", "POST", {}, auth);
  assert(advice.data.actions.length > 0);
  await writeFile(evidence + "/live-ai-results.json", JSON.stringify({
    result: "passed", model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    products: 2, spending_cents: 34000, currency: "DOP", ocr: "real",
    confirmed_in: "isolated in-memory database", advice: "real",
  }, null, 2));
  console.log("IA real aprobada: OCR de dos productos, importación revisada, gasto RD$ 340 y sugerencias de ahorro.");
} finally {
  await browser.close();
  if (app) {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
  }
}
