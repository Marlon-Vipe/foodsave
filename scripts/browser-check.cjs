const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const root = process.cwd();
  const evidence = path.join(root, "docs/evidence");
  fs.mkdirSync(evidence, { recursive: true });
  const accounts = JSON.parse(
    fs.readFileSync(path.join(root, ".demo-credentials.json")),
  );
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: evidence, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (role) => {
    const a = accounts.find((a) => a.role === role);
    await page.getByLabel("Correo electrónico").fill(a.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(a.password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
  };
  await page.goto("http://localhost:3000");
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(evidence, "01-login-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login("administrador");
  await page.getByRole("heading", { name: "Gestión de usuarios" }).waitFor();
  await page.screenshot({
    path: path.join(evidence, "02-users-admin.png"),
    fullPage: true,
  });
  const readerRow = page
    .getByRole("row")
    .filter({ hasText: "lector@foodsave.test" });
  await readerRow.getByRole("combobox").selectOption("editor");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/users") && r.request().method() === "GET",
    ),
    readerRow.getByRole("button", { name: "Guardar rol" }).click(),
  ]);
  await readerRow.getByRole("combobox").selectOption("lector");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/users") && r.request().method() === "GET",
    ),
    readerRow.getByRole("button", { name: "Guardar rol" }).click(),
  ]);
  await page
    .getByRole("button", { name: "Roles y permisos", exact: true })
    .click();
  await page.getByRole("heading", { name: "Roles y permisos" }).waitFor();
  const roleForm = page.locator('form[data-role="supervisor"]');
  await roleForm
    .getByRole("checkbox", { name: "Gestionar alimentos", exact: true })
    .check();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/roles") && r.request().method() === "GET",
    ),
    roleForm.getByRole("button", { name: "Guardar permisos" }).click(),
  ]);
  await roleForm
    .getByRole("checkbox", { name: "Gestionar alimentos", exact: true })
    .uncheck();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/roles") && r.request().method() === "GET",
    ),
    roleForm.getByRole("button", { name: "Guardar permisos" }).click(),
  ]);
  await page.screenshot({
    path: path.join(evidence, "03-roles-permissions.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Actividades", exact: true }).click();
  await page
    .getByRole("heading", { name: "Actividades de usuarios" })
    .waitFor();
  await page.screenshot({
    path: path.join(evidence, "04-audit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Inventario", exact: true }).click();
  await page.getByRole("heading", { name: "Mi inventario" }).waitFor();
  await page.screenshot({
    path: path.join(evidence, "05-inventory-admin.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  await login("lector");
  await page.getByRole("button", { name: "Inventario", exact: true }).click();
  await page.getByRole("heading", { name: "Mi inventario" }).waitFor();
  if (await page.getByRole("button", { name: "Guardar alimento" }).count())
    throw Error("Lector tiene controles de escritura");
  if (await page.getByRole("button", { name: "Usuarios", exact: true }).count())
    throw Error("Lector tiene acceso de administración");
  const denied = await page.evaluate(async () => {
    const res = await fetch("/api/users");
    return { status: res.status, body: await res.json() };
  });
  if (denied.status !== 403) throw Error("Se esperaba 403");
  await page.screenshot({
    path: path.join(evidence, "06-reader-restricted.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  await page
    .getByRole("button", { name: "¿No tienes cuenta? Crear cuenta" })
    .click();
  await page.getByLabel("Nombre completo").fill("Usuario de demostración");
  const demoEmail = "demo-" + Date.now() + "@example.test";
  await page.getByLabel("Correo electrónico").fill(demoEmail);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("Demo-segura-" + Date.now() + "!");
  await page.screenshot({
    path: path.join(evidence, "07-register.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  await login("editor");
  await page.getByRole("button", { name: "Inventario", exact: true }).click();
  await page.getByLabel("Nombre del alimento").fill("Manzanas demo");
  await page
    .getByLabel("Categoría", { exact: true })
    .selectOption("Frutas y verduras");
  await page.getByLabel("Fecha de vencimiento").fill("2026-12-01");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/inventory") && r.request().method() === "GET",
    ),
    page.getByRole("button", { name: "Guardar alimento" }).click(),
  ]);
  const food = page.locator(".food-row").filter({ hasText: "Manzanas demo" });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/inventory") && r.request().method() === "GET",
    ),
    food.getByRole("button", { name: "Consumido", exact: true }).click(),
  ]);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  await login("supervisor");
  await page.getByRole("button", { name: "Reportes", exact: true }).click();
  await page.getByRole("heading", { name: "Estadísticas" }).waitFor();
  await page.screenshot({
    path: path.join(evidence, "08-reports-supervisor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  const overflow = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      overflow.push(width);
  }
  if (errors.length || overflow.length)
    throw Error(JSON.stringify({ errors, overflow }));
  await page.close();
  await context.close();
  const files = fs
    .readdirSync(evidence)
    .filter((f) => f.endsWith(".webm") && f !== "demo-foodsave.webm");
  fs.renameSync(
    path.join(evidence, files[0]),
    path.join(evidence, "demo-foodsave.webm"),
  );
  await browser.close();
  fs.writeFileSync(
    path.join(evidence, "browser-results.json"),
    JSON.stringify(
      {
        result: "passed",
        viewports: [390, 768, 1440],
        checks: [
          "login",
          "logout",
          "registro",
          "administración de usuarios",
          "asignación de rol desde interfaz",
          "edición de permisos desde interfaz",
          "auditoría",
          "creación y consumo de alimento desde interfaz",
          "reportes",
          "controles ocultos al lector",
          "API 403 al lector",
          "sin errores JavaScript",
          "sin desbordamiento horizontal",
        ],
        denied,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Browser verification passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
