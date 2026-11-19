import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";

const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = await createApp({ database: ":memory:", origin });
const password = "Prueba-responsive-2026!";
const admin = Number(app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
  .run("Administración de demostración", "responsive@example.test", await hashPassword(password), "administrador").lastInsertRowid);
for (let i = 0; i < 18; i++)
  app.db.prepare("INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)")
    .run("Alimento de demostración " + (i + 1), "Otros", i + 1, "2099-12-31", admin);
app.server.listen(port, "127.0.0.1");
await once(app.server, "listening");
const evidence = process.env.FOODSAVE_EVIDENCE_DIR ?? "docs/logistics/evidence";
await mkdir(evidence, { recursive: true });
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "es-DO" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel("Correo electrónico").fill("responsive@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("heading", { name: "Gestión de usuarios" }).waitFor();
  const assertLogout = async (label) => {
    const visible = await page.locator("#logout").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight &&
        rect.left >= 0 && rect.right <= innerWidth && button.contains(center);
    });
    assert(visible, "Cerrar sesión no es accesible en " + label);
    const overflow = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= innerWidth) return [];
      return [...document.querySelectorAll(".sidebar, .sidebar-brand, .account, .topbar, main, .stats, .stat, .panel, .page-heading")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth)
        .map((el) => ({ class: el.className, right: el.getBoundingClientRect().right }));
    });
    if (overflow.length) await page.screenshot({ path: evidence + "/responsive-overflow.png" });
    assert.deepEqual(overflow, [], "Desborde de página en " + label);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Desborde de texto en " + label);
  };
  const navigate = async (name) => {
    const menu = page.locator("#menu-toggle");
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name, exact: true }).click();
    await page.locator("main h1").waitFor();
    await page.waitForFunction(() => !document.querySelector("main")?.textContent.includes("Cargando…"));
  };
  const viewports = [
    [320, 568], [390, 844], [700, 600], [701, 600],
    [768, 800], [844, 390], [1024, 768], [1440, 900],
  ];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const module of ["Mi espacio", "Usuarios", "Roles y permisos", "Actividades", "Inventario", "Reportes", "Operaciones", "Logística"]) {
      await navigate(module);
      await assertLogout(`${module}, ${width}×${height}, inicio`);
      if (module === "Mi espacio" && [390, 1440].includes(width)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: evidence + `/home-${width}.png` });
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await assertLogout(`${module}, ${width}×${height}, final`);
      if (module === "Logística" && [390, 1440].includes(width))
        await page.screenshot({ path: evidence + `/responsive-${width}-logout.png` });
    }
    if (width <= 700) {
      await page.locator("#menu-toggle").click();
      assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "true");
      await page.locator("#menu-toggle").press("Escape");
      assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "false");
    }
  }
  await navigate("Mi espacio");
  assert.equal(await page.getByRole("button", { name: "Abrir Inventario", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Abrir Inventario", exact: true }).click();
  await page.getByRole("heading", { name: "Mi inventario", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await page.getByRole("heading", { name: "Iniciar sesión", exact: true }).waitFor();
  app.db.prepare("INSERT INTO users(name,email,password,role) SELECT 'Lector de prueba','lector@example.test',password,'lector' FROM users WHERE id=?").run(admin);
  await page.getByLabel("Correo electrónico").fill("lector@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("heading", { name: "Hola, Lector.", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Abrir Inventario", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Abrir Logística", exact: true }).count(), 0);
  assert.equal(await page.locator(".home-metric strong").first().innerText(), "171");
  assert.deepEqual(errors, []);
  console.log("Responsive aprobado en 8 tamaños y 8 módulos: cerrar sesión visible y pulsable al inicio y al final, menú móvil, Escape, sin desborde de página y logout correcto.");
} finally {
  await browser?.close();
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
}
