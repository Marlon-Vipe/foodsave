const app = document.querySelector("#app");
let auth = null,
  current = "users",
  register = false;
const labels = {
  "users.read": "Ver usuarios",
  "users.manage": "Administrar usuarios",
  "roles.manage": "Administrar roles",
  "audit.read": "Consultar actividades",
  "inventory.read": "Ver inventario",
  "inventory.manage": "Gestionar alimentos",
  "reports.read": "Ver reportes",
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
];
async function renderShell() {
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div><div class="brand">foodsave<span>.</span></div><small>Come mejor, desperdicia menos.</small></div><nav>${navItems
    .filter((n) => !n[2] || has(n[2]))
    .map(
      (n) =>
        `<button class="nav ${current === n[0] ? "active" : ""}" data-page="${n[0]}">${n[1]}</button>`,
    )
    .join(
      "",
    )}</nav><div class="account"><div><strong>${escape(auth.user.name)}</strong><small>${escape(auth.user.role)}</small></div><button id="logout">Cerrar sesión</button></div></aside><div class="workspace"><header class="topbar"><span>Mi espacio / ${navItems.find((n) => n[0] === current)?.[1] ?? "Acceso"}</span><span class="secure">Sesión protegida</span></header><main aria-live="polite"><p>Cargando…</p></main></div></div>`;
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
      main
        .querySelectorAll("[data-save]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              changeUser(Number(b.dataset.save), {
                role: main.querySelector(`[data-role="${b.dataset.save}"]`)
                  .value,
              })),
        );
      main
        .querySelectorAll("[data-toggle]")
        .forEach(
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
      `<div class="stats"><div class="stat"><small>APROVECHAMIENTO</small><strong>${total ? Math.round((100 * count("consumed")) / total) : 0}%</strong><small>De alimentos procesados</small></div><div class="stat"><small>APROVECHADOS</small><strong>${count("consumed")}</strong><small>Alimentos consumidos</small></div><div class="stat"><small>DESPERDICIADOS</small><strong>${count("wasted")}</strong><small>Alimentos descartados</small></div></div><section class="panel"><h2>Historial</h2><div class="table-wrap"><table><thead><tr><th>Alimento</th><th>Categoría</th><th>Resultado</th></tr></thead><tbody>${history.map((f) => `<tr><td>${escape(f.name)}</td><td>${escape(f.category)}</td><td>${f.status === "consumed" ? "Aprovechado" : "Descartado"}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">Aún no hay alimentos procesados.</td></tr>'}</tbody></table></div></section>`;
    return;
  }
  main.innerHTML =
    heading(
      "FoodSave / Mi espacio",
      `Hola, ${escape(auth.user.name.split(" ")[0])}`,
      "Todo lo que necesitas para cuidar tus alimentos y reducir desperdicios.",
    ) +
    `<section class="panel module"><span class="badge">${escape(auth.user.role)}</span><h2>Bienvenido a tu espacio</h2><p>Tu cuenta está activa. Estas son las funcionalidades habilitadas para tu perfil:</p>${auth.permissions.map((p) => `<p>✓ ${labels[p]}</p>`).join("")}<div class="callout">Los permisos se validan en cada solicitud al servidor.</div></section>`;
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
