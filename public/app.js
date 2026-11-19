import { renderLogistics } from "./logistics.js";
import { renderOperations } from "./operations.js";
const app = document.querySelector("#app");
let auth = null,
  current = "users",
  operationDraft = null,
  register = false;
const labels = {
  "users.read": "Ver usuarios",
  "users.manage": "Administrar usuarios",
  "roles.manage": "Administrar roles",
  "audit.read": "Consultar actividades",
  "inventory.read": "Ver inventario",
  "inventory.manage": "Gestionar alimentos",
  "reports.read": "Ver reportes",
  "operations.read": "Consultar operaciones",
  "operations.manage": "Gestionar operaciones",
  "operations.close": "Cerrar operaciones",
  "operations.report": "Generar reportes de operaciones",
  "logistics.read": "Consultar logística",
  "logistics.move": "Registrar movimientos logísticos",
  "logistics.report": "Generar reportes logísticos",
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const has = (p) => auth?.permissions.includes(p);
async function api(path, method = "GET", body) {
  const res = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { "X-CSRF-Token": auth.csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.headers.get("content-type")?.includes("application/json"))
    throw new Error("No se pudo conectar con FoodSave. Intenta de nuevo (HTTP " + res.status + ").");
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && auth) {
      auth = null;
      renderAuth();
    }
    throw new Error(data.error);
  }
  return data;
}
function notify(message) {
  const el = document.querySelector("#notice");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.remove("visible"), 5000);
}
function renderAuth() {
  app.innerHTML = `<div class="auth"><header class="auth-header"><img src="/assets/c09a3.svg" alt=""><img class="orb" src="/assets/05e4b.svg" alt=""><div class="auth-logo"><img src="/assets/8585a.svg" alt=""><img src="/assets/2f46b.svg" alt=""></div><h1>${register ? "Cuida lo que importa" : "Bienvenido de nuevo"}</h1><p>Tu inventario te está esperando.</p></header><form class="auth-card"><h2>${register ? "Crear cuenta" : "Iniciar sesión"}</h2><p>${register ? "Empieza a cuidar tus alimentos." : "Accede para seguir cuidando tus alimentos."}</p><div id="form-error" role="alert"></div>${register ? '<label for="name">Nombre completo</label><input id="name" name="name" autocomplete="name" required minlength="2" maxlength="100" placeholder="Tu nombre y apellido">' : ""}<label for="email">Correo electrónico</label><div class="input-wrap"><img src="/assets/5596c.svg" alt=""><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="nombre@correo.com"></div><label for="password">Contraseña</label><div class="input-wrap"><img src="/assets/5d527.svg" alt=""><input id="password" name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" required ${register ? 'minlength="12"' : ""} maxlength="128" placeholder="${register ? "Mínimo 12 caracteres" : "Tu contraseña"}"></div>${register ? "<small>Tu cuenta tendrá el perfil de lector.</small>" : '<button class="password-help" type="button">¿Olvidaste tu contraseña?</button>'}<button class="auth-submit" type="submit">${register ? "Crear mi cuenta" : "Entrar"}</button><button class="auth-switch" type="button">${register ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta"}</button></form><footer class="auth-footer">Protegemos tus datos y tu tranquilidad · FoodSave</footer></div>`;
  const help = app.querySelector(".password-help");
  if (help)
    help.onclick = () =>
      notify(
        "Contacta al administrador de FoodSave para recuperar el acceso. El restablecimiento por correo no forma parte de esta entrega.",
      );
  app.querySelector(".auth-switch").onclick = () => {
    register = !register;
    renderAuth();
  };
  app.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      if (register) {
        await api("register", "POST", body);
        register = false;
        renderAuth();
        notify("Cuenta creada. Ya puedes iniciar sesión.");
      } else {
        auth = await api("login", "POST", body);
        current = has("users.read") ? "users" : "home";
        await renderShell();
      }
    } catch (error) {
      const target = document.querySelector("#form-error");
      if (target) {
        target.className = "error";
        target.textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
  };
}
const navItems = [
  ["home", "Mi espacio", null],
  ["users", "Usuarios", "users.read"],
  ["roles", "Roles y permisos", "roles.manage"],
  ["audit", "Actividades", "audit.read"],
  ["inventory", "Inventario", "inventory.read"],
  ["reports", "Reportes", "reports.read"],
  ["operations", "Operaciones", "operations.read"],
  ["logistics", "Logística", "logistics.read"],
];
async function renderShell() {
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="sidebar-brand"><div><div class="brand">foodsave<span>.</span></div><small>Come mejor, desperdicia menos.</small></div><button type="button" id="menu-toggle" aria-expanded="false" aria-controls="primary-navigation" aria-label="Abrir menú">☰</button></div><nav id="primary-navigation" aria-label="Navegación principal">${navItems
    .filter((n) => !n[2] || has(n[2]))
    .map(
      (n) =>
        `<button class="nav ${current === n[0] ? "active" : ""}" data-page="${n[0]}">${n[1]}</button>`,
    )
    .join(
      "",
    )}</nav><div class="account"><div><strong>${escape(auth.user.name)}</strong><small>${escape(auth.user.role)}</small></div><button id="logout">Cerrar sesión</button></div></aside><div class="workspace"><header class="topbar"><span>${current === "home" ? "Mi espacio" : "Mi espacio / " + (navItems.find((n) => n[0] === current)?.[1] ?? "Acceso")}</span><span class="secure">Sesión protegida</span></header><main aria-live="polite"><p>Cargando…</p></main></div></div>`;
  const sidebar = app.querySelector(".sidebar");
  const menuToggle = app.querySelector("#menu-toggle");
  const setMenuOpen = (open) => {
    sidebar.dataset.menuOpen = String(open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    menuToggle.textContent = open ? "✕" : "☰";
  };
  menuToggle.onclick = () => setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  sidebar.onkeydown = (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
      menuToggle.focus();
    }
  };
  app.querySelectorAll("[data-page]").forEach(
    (button) =>
      (button.onclick = () => {
        current = button.dataset.page;
        renderShell();
      }),
  );
  app.querySelector("#logout").onclick = async () => {
    try {
      await api("logout", "POST", {});
      auth = null;
      register = false;
      renderAuth();
      notify("Sesión cerrada correctamente.");
    } catch (e) {
      notify(e.message);
    }
  };
  try {
    await renderPage();
  } catch (error) {
    const main = app.querySelector("main");
    if (main)
      main.innerHTML = `<div class="error" role="alert">${escape(error.message)}</div>`;
  }
}
function heading(tag, title, description) {
  return `<div class="page-heading"><div><div class="eyebrow">${tag}</div><h1>${title}</h1><p>${description}</p></div></div>`;
}
async function renderPage() {
  const main = app.querySelector("main");
  if (current === "logistics") {
    await renderLogistics({ main, api, has, notify, escape, heading,
      prepareDiscard: async (lot) => {
        operationDraft = {
          type: "descarte", food_id: lot.id, quantity: lot.on_hand,
          title: ("Descarte de " + lot.name).slice(0, 120),
          notes: "Preparado desde una alerta logística de vencimiento.",
        };
        current = "operations";
        await renderShell();
      },
    });
    return;
  }
  if (current === "operations") {
    const draft = operationDraft;
    operationDraft = null;
    await renderOperations({ main, api, has, notify, draft });
    return;
  }
  if (current === "users") {
    const { users } = await api("users");
    main.innerHTML =
      heading(
        "Configuración / Accesos",
        "Gestión de usuarios",
        "Las personas correctas, con el acceso que necesitan.",
      ) +
      `<div class="stats"><div class="stat"><small>USUARIOS REGISTRADOS</small><strong>${users.length}</strong><small>Personas en tu plataforma</small></div><div class="stat"><small>CUENTAS ACTIVAS</small><strong>${users.filter((u) => u.active).length}</strong><small>Con acceso habilitado</small></div><div class="stat"><small>PERFILES DISPONIBLES</small><strong>4</strong><small>Responsabilidades definidas</small></div></div><section class="panel"><div class="panel-head"><h2>Todos los usuarios</h2><input id="search" aria-label="Buscar usuarios" placeholder="Buscar nombre o correo…" type="search"></div><div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Perfil</th><th>Estado</th><th>Acciones</th></tr></thead><tbody></tbody></table></div></section><div class="callout">Los registros nuevos reciben el perfil de lector. Los cambios de rol o estado cierran las sesiones del usuario para que vuelva a autenticarse con sus nuevos permisos.</div>`;
    const draw = () => {
      const query = app.querySelector("#search").value.toLowerCase();
      main.querySelector("tbody").innerHTML =
        users
          .filter((u) => (u.name + " " + u.email).toLowerCase().includes(query))
          .map(
            (u) =>
              `<tr><td><strong>${escape(u.name)} ${u.id === auth.user.id ? "(tú)" : ""}</strong><small>${escape(u.email)}</small></td><td><span class="badge">${escape(u.role)}</span></td><td><span class="badge ${u.active ? "" : "inactive"}">${u.active ? "Activo" : "Inactivo"}</span></td><td>${has("users.manage") && u.id !== auth.user.id ? `<div class="row-actions"><select aria-label="Rol de ${escape(u.name)}" data-role="${u.id}">${["administrador", "editor", "supervisor", "lector"].map((r) => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select><button class="secondary" data-save="${u.id}">Guardar rol</button><button class="${u.active ? "danger" : "secondary"}" data-toggle="${u.id}">${u.active ? "Desactivar" : "Activar"}</button></div>` : "—"}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="4" class="empty">No se encontraron usuarios.</td></tr>';
      main.querySelectorAll("[data-save]").forEach(
        (b) =>
          (b.onclick = () =>
            changeUser(Number(b.dataset.save), {
              role: main.querySelector(`[data-role="${b.dataset.save}"]`).value,
            })),
      );
      main.querySelectorAll("[data-toggle]").forEach(
        (b) =>
          (b.onclick = () =>
            changeUser(Number(b.dataset.toggle), {
              active: !users.find((u) => u.id === Number(b.dataset.toggle))
                .active,
            })),
      );
    };
    main.querySelector("#search").oninput = draw;
    draw();
    return;
  }
  if (current === "roles") {
    const { roles, permissions } = await api("roles");
    main.innerHTML =
      heading(
        "Configuración / Seguridad",
        "Roles y permisos",
        "Define las funcionalidades disponibles para cada perfil.",
      ) +
      `<div class="role-grid">${roles.map((r) => `<form class="panel role-form" data-role="${r.id}"><h2>${r.id}</h2><p>${r.id === "administrador" ? "Control completo de la plataforma." : "Selecciona las funcionalidades autorizadas."}</p>${permissions.map((p) => `<label class="check"><input type="checkbox" name="permission" value="${p}" ${r.permissions.includes(p) ? "checked" : ""} ${r.id === "administrador" || ["users.manage", "roles.manage"].includes(p) ? "disabled" : ""}>${labels[p]}</label>`).join("")}${r.id !== "administrador" ? '<button type="submit">Guardar permisos</button>' : "<small>Permisos protegidos para garantizar la administración.</small>"}</form>`).join("")}</div>`;
    main.querySelectorAll("form").forEach(
      (form) =>
        (form.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await api("roles/" + form.dataset.role, "PUT", {
              permissions: [...form.querySelectorAll("input:checked")].map(
                (i) => i.value,
              ),
            });
            notify(
              "Permisos actualizados. Las sesiones del perfil fueron revocadas.",
            );
            await renderPage();
          } catch (e) {
            notify(e.message);
          }
        }),
    );
    return;
  }
  if (current === "audit") {
    const { events } = await api("audit");
    const actions = {
      "login.succeeded": "Inicio de sesión",
      "login.failed": "Intento de acceso fallido",
      logout: "Cierre de sesión",
      "user.registered": "Registro de usuario",
      "user.updated": "Cambio de usuario",
      "role.updated": "Cambio de permisos",
      "access.denied": "Acceso denegado",
      "food.created": "Alimento registrado",
      "food.consumed": "Alimento aprovechado",
      "food.wasted": "Alimento descartado",
      "report.generated": "Reporte generado",
      "operation.created": "Operación creada",
      "operation.updated": "Operación actualizada",
      "operation.started": "Operación iniciada",
      "operation.closed": "Operación cerrada",
      "operation.cancelled": "Operación cancelada",
      "operation.report": "Reporte de operaciones generado",
      "logistics.minimum.updated": "Mínimo de existencias actualizado",
      "logistics.movement": "Movimiento logístico registrado",
      "logistics.report": "Reporte logístico generado",
    };
    main.innerHTML =
      heading(
        "Configuración / Trazabilidad",
        "Actividades de usuarios",
        "Consulta los accesos y los cambios de seguridad de la plataforma.",
      ) +
      `<section class="panel"><div class="panel-head"><h2>Actividad reciente</h2><button class="secondary" id="refresh">Actualizar</button></div><div class="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Actividad</th><th>Detalle</th></tr></thead><tbody>${events.map((e) => `<tr><td>${escape(new Date(e.created_at.replace(" ", "T") + "Z").toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }))}</td><td>${escape(e.actor ?? "Sin autenticar")}</td><td>${escape(actions[e.action] ?? e.action)}</td><td>${escape(e.target)}</td></tr>`).join("") || '<tr><td colspan="4">No hay actividades.</td></tr>'}</tbody></table></div></section><small>Últimos 200 eventos · Hora de Santo Domingo</small>`;
    main.querySelector("#refresh").onclick = renderPage;
    return;
  }
  if (current === "inventory") {
    const { foods } = await api("inventory");
    main.innerHTML =
      heading(
        "FoodSave / Mi espacio",
        "Mi inventario",
        "Tus alimentos, siempre a la vista.",
      ) +
      `<section class="panel"><div class="panel-head"><h2>Alimentos registrados</h2><input type="search" id="food-search" placeholder="Buscar alimentos…" aria-label="Buscar alimentos"></div><div class="food-filters"><button class="secondary" id="all-foods">Todos</button><button class="secondary" id="expiring">Por vencer</button><select id="category-filter" aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>${["Lácteos", "Carnes", "Frutas y verduras", "Panadería", "Congelados", "Otros"].map((c) => `<option>${c}</option>`).join("")}</select></div><div id="food-list"></div></section>${has("inventory.manage") ? `<form class="panel" id="food-form"><h2>Nuevo alimento</h2><p>Añade un producto y anticipa su vencimiento.</p><label for="food-name">Nombre del alimento</label><input id="food-name" name="name" placeholder="Ej. Leche entera" minlength="2" maxlength="100" required><div class="food-form-grid"><div><label for="food-category">Categoría</label><select id="food-category" name="category">${["Lácteos", "Carnes", "Frutas y verduras", "Panadería", "Congelados", "Otros"].map((c) => `<option>${c}</option>`).join("")}</select></div><div><label for="food-date">Fecha de vencimiento</label><input id="food-date" name="expires" type="date" required></div><div><label for="food-quantity">Cantidad</label><input id="food-quantity" name="quantity" type="number" min="1" max="10000" value="1" required></div></div><button class="auth-submit" type="submit">Guardar alimento</button></form>` : '<div class="callout">Tu perfil permite consultar el inventario. La edición requiere el permiso Gestionar alimentos.</div>'}`;
    let expiring = false;
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Santo_Domingo",
    });
    const days = (f) =>
      Math.round((Date.parse(f.expires) - Date.parse(today)) / 86400000);
    const draw = () => {
      const query = main.querySelector("#food-search").value.toLowerCase(),
        category = main.querySelector("#category-filter").value;
      const list = foods.filter(
        (f) =>
          f.name.toLowerCase().includes(query) &&
          (!category || f.category === category) &&
          (!expiring || days(f) <= 3),
      );
      main.querySelector("#food-list").innerHTML =
        list
          .map(
            (f) =>
              `<article class="food-row"><div class="food-icon"><img src="/assets/2de35.svg" alt=""></div><div><strong>${escape(f.name)}</strong><small>${escape(f.category)} · ${f.quantity} ${f.quantity === 1 ? "unidad" : "unidades"}</small></div><span class="badge ${days(f) < 0 ? "inactive" : ""}">${days(f) < 0 ? "Vencido" : days(f) === 0 ? "Hoy" : days(f) + " días"}</span>${has("inventory.manage") ? `<div class="food-actions"><button class="secondary" data-food="${f.id}" data-status="consumed">Consumido</button><button class="danger" data-food="${f.id}" data-status="wasted">Descartado</button></div>` : ""}</article>`,
          )
          .join("") ||
        '<div class="empty">No hay alimentos para mostrar.</div>';
      main.querySelectorAll("[data-food]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await api("inventory/" + b.dataset.food, "PATCH", {
                status: b.dataset.status,
              });
              notify("Alimento actualizado.");
              await renderPage();
            } catch (e) {
              notify(e.message);
            }
          }),
      );
    };
    main.querySelector("#food-search").oninput = draw;
    main.querySelector("#category-filter").onchange = draw;
    main.querySelector("#expiring").onclick = () => {
      expiring = true;
      draw();
    };
    main.querySelector("#all-foods").onclick = () => {
      expiring = false;
      draw();
    };
    draw();
    const form = main.querySelector("#food-form");
    if (form)
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(form));
        body.quantity = Number(body.quantity);
        try {
          await api("inventory", "POST", body);
          notify("Alimento guardado.");
          await renderPage();
        } catch (e) {
          notify(e.message);
        }
      };
    return;
  }
  if (current === "reports") {
    const { summary, history } = await api("reports");
    const count = (status) =>
      summary.find((s) => s.status === status)?.count ?? 0;
    const total = count("consumed") + count("wasted");
    main.innerHTML =
      heading(
        "FoodSave / Estadísticas",
        "Estadísticas",
        "Tus pequeños cambios generan impacto.",
      ) +
      `<div class="report-actions"><a class="button" href="/api/reports/export.csv">Descargar reporte CSV</a><a class="button secondary-link" href="/api/reports/print" target="_blank" rel="noopener">Generar reporte / guardar PDF</a></div><div class="stats"><div class="stat"><small>APROVECHAMIENTO</small><strong>${total ? Math.round((100 * count("consumed")) / total) : 0}%</strong><small>De alimentos procesados</small></div><div class="stat"><small>APROVECHADOS</small><strong>${count("consumed")}</strong><small>Alimentos consumidos</small></div><div class="stat"><small>DESPERDICIADOS</small><strong>${count("wasted")}</strong><small>Alimentos descartados</small></div></div><section class="panel"><h2>Historial</h2><div class="table-wrap"><table><thead><tr><th>Alimento</th><th>Categoría</th><th>Resultado</th></tr></thead><tbody>${history.map((f) => `<tr><td>${escape(f.name)}</td><td>${escape(f.category)}</td><td>${({ consumed: "Aprovechado", wasted: "Descartado", distributed: "Agotado por salida logística" })[f.status] ?? f.status}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">Aún no hay alimentos procesados.</td></tr>'}</tbody></table></div></section>`;
    return;
  }
  await renderHome(main);
}

async function renderHome(main) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
  const dateLabel = new Intl.DateTimeFormat("es-DO", {
    timeZone: "America/Santo_Domingo", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());
  let available = null, expiring = null, expired = null;
  if (has("logistics.read")) {
    const { summary } = await api("logistics/dashboard");
    available = summary.available_units;
    expiring = summary.expiring_lots;
    expired = summary.expired_lots;
  } else if (has("inventory.read")) {
    const { foods } = await api("inventory");
    available = foods.filter((food) => food.expires >= today).reduce((sum, food) => sum + food.quantity, 0);
    expired = foods.filter((food) => food.expires < today).length;
    expiring = foods.filter((food) => {
      const days = (Date.parse(food.expires) - Date.parse(today)) / 86400000;
      return days >= 0 && days <= 7;
    }).length;
  }
  const modules = [
    { page: "inventory", title: "Inventario", group: "Alimentos", tone: "sage",
      description: "Consulta tus alimentos, cantidades y fechas de vencimiento.", permission: "inventory.read" },
    { page: "logistics", title: "Logística", group: "Distribución", tone: "peach",
      description: "Revisa alertas y organiza las entradas y salidas de tus lotes.", permission: "logistics.read" },
    { page: "operations", title: "Operaciones", group: "Planificación", tone: "blue",
      description: "Da seguimiento al consumo y al descarte de alimentos.", permission: "operations.read" },
    { page: "reports", title: "Reportes", group: "Resultados", tone: "sand",
      description: "Consulta el aprovechamiento y descarga tus reportes.", permission: "reports.read" },
    { page: "users", title: "Usuarios", group: "Equipo", tone: "blue",
      description: "Consulta las personas y los perfiles de tu plataforma.", permission: "users.read" },
    { page: "roles", title: "Roles y permisos", group: "Configuración", tone: "sage",
      description: "Administra qué puede hacer cada perfil del equipo.", permission: "roles.manage" },
    { page: "audit", title: "Actividades", group: "Seguimiento", tone: "sand",
      description: "Revisa los accesos y los cambios registrados por el equipo.", permission: "audit.read" },
  ].filter((module) => has(module.permission));
  const primary = has("logistics.read") ? "logistics" : has("inventory.read") ? "inventory" : modules[0]?.page;
  const primaryTitle = navItems.find((item) => item[0] === primary)?.[1];
  main.innerHTML = `
    <section class="home-welcome" aria-labelledby="home-title">
      <div class="home-welcome-content">
        <p class="home-date">${escape(dateLabel)}</p>
        <h1 id="home-title">Hola, ${escape(auth.user.name.trim().split(/\s+/u)[0])}<span>.</span></h1>
        <p>Cuida tus alimentos. Organiza tu día.</p>
        ${primary ? `<button class="home-primary" data-home-page="${primary}">Ir a ${primaryTitle} <span aria-hidden="true">↗</span></button>` : ""}
      </div>
      <div class="home-profile">
        <span class="home-avatar" aria-hidden="true">${escape(auth.user.name.trim().slice(0, 1).toLocaleUpperCase("es"))}</span>
        <div><strong>${escape(auth.user.name)}</strong><span>${escape(auth.user.role)}</span></div>
      </div>
    </section>
    ${available !== null ? `<section class="home-metrics" aria-label="Resumen de alimentos">
      <article class="home-metric"><span class="home-metric-mark sage" aria-hidden="true">✓</span><div><span>Unidades disponibles</span><strong>${available}</strong><small>En lotes vigentes</small></div></article>
      <article class="home-metric"><span class="home-metric-mark sand" aria-hidden="true">◷</span><div><span>Lotes por vencer</span><strong>${expiring}</strong><small>Hoy y los próximos 7 días</small></div></article>
      <article class="home-metric"><span class="home-metric-mark peach" aria-hidden="true">!</span><div><span>Lotes vencidos</span><strong>${expired}</strong><small>Pendientes de revisión</small></div></article>
    </section>` : ""}
    <section class="home-modules" aria-labelledby="home-modules-title">
      <div class="home-section-heading"><h2 id="home-modules-title">Tus herramientas</h2><p>Accede a las funciones de tu perfil.</p></div>
      <div class="home-module-grid">${modules.map((module) => `
        <button class="home-module" data-home-page="${module.page}" aria-label="Abrir ${module.title}">
          <span class="home-module-top"><span class="home-module-group ${module.tone}">${module.group}</span><span class="home-module-arrow" aria-hidden="true">↗</span></span>
          <strong>${module.title}</strong><span class="home-module-description">${module.description}</span>
        </button>`).join("") || '<p class="callout">Tu cuenta está activa. Contacta al administrador para habilitar las herramientas que necesitas.</p>'}</div>
    </section>
    <details class="home-permissions"><summary>Ver mis permisos</summary><div>${auth.permissions.map((permission) => `<span>${escape(labels[permission] ?? permission)}</span>`).join("") || "<p>Tu perfil todavía no tiene permisos asignados.</p>"}</div></details>`;
  main.querySelectorAll("[data-home-page]").forEach((button) => {
    button.onclick = () => {
      current = button.dataset.homePage;
      renderShell();
    };
  });
}
async function changeUser(id, body) {
  try {
    await api("users/" + id, "PATCH", body);
    notify("Usuario actualizado. Sus sesiones fueron cerradas.");
    await renderPage();
  } catch (e) {
    notify(e.message);
  }
}
try {
  auth = await api("me");
  current = has("users.read") ? "users" : "home";
  await renderShell();
} catch {
  renderAuth();
}
