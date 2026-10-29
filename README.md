# FoodSave · Épica 1: usuarios, roles y accesos

Incremento ejecutable de autenticación, autorización y trazabilidad para **FoodSave**. El usuario confirmó que esta entrega corresponde a FoodSave, aunque el enunciado original mencionaba una plataforma inmobiliaria. La referencia visual es [el prototipo de Figma](https://www.figma.com/design/qVQHZLksgSjCqXir63rG9z/Untitled?node-id=4-25).

## Ejecutar

Requisito: **Node.js 24 o posterior**, con `node:sqlite`. El servidor y las pruebas HTTP usan exclusivamente módulos nativos de Node; no necesitan instalar paquetes ni un servicio de base de datos.

```sh
git clone https://github.com/Marlon-Vipe/foodsave.git
cd foodsave
npm run demo
npm start
```

Abre **http://localhost:3000**. `npm run demo` crea cuatro cuentas y cinco alimentos de ejemplo. Imprime contraseñas aleatorias y las guarda en `.demo-credentials.json`, un archivo local excluido de Git. En ejecuciones posteriores conserva las cuentas existentes. Esta información es exclusivamente para la demostración local.

Para crear un administrador sin los datos de ejemplo, define `ADMIN_EMAIL` y `ADMIN_PASSWORD` (12–128 caracteres) en el entorno y ejecuta `npm run seed`. El registro público siempre crea lectores; nunca acepta el rol enviado por el navegador.

SQLite se crea automáticamente en `app.sqlite`; los datos persisten al reiniciar. `DATABASE_PATH`, `PORT` y `APP_ORIGIN` permiten configurar otro archivo, puerto y origen. El origen debe coincidir exactamente con la URL usada en el navegador. El proceso escucha en `127.0.0.1`; para un entorno remoto se necesita un proxy HTTPS hacia ese puerto. Las cookies usan `Secure` cuando `APP_ORIGIN` empieza con `https://`.

## Perfiles iniciales

| Funcionalidad                                 | Administrador | Editor | Supervisor | Lector |
| --------------------------------------------- | ------------- | ------ | ---------- | ------ |
| Consultar inventario, búsqueda y filtros      | Sí            | Sí     | Sí         | Sí     |
| Registrar alimentos y marcar consumo/descarte | Sí            | Sí     | No         | No     |
| Consultar estadísticas e historial            | Sí            | No     | Sí         | No     |
| Listar usuarios                               | Sí            | No     | No         | No     |
| Asignar roles, activar/desactivar usuarios    | Sí            | No     | No         | No     |
| Editar permisos por perfil                    | Sí            | No     | No         | No     |
| Consultar bitácora                            | Sí            | No     | No         | No     |

El administrador puede modificar permisos de los otros perfiles. `users.manage` y `roles.manage` se reservan al administrador. Su rol conserva todos los permisos y no puede quitarse a sí mismo el acceso administrativo. Cambiar un rol o un estado revoca las sesiones del usuario; modificar permisos revoca todas las sesiones del perfil.

Esta versión modela **un único inventario compartido**. Los roles gobiernan el acceso a ese espacio común. La separación por hogares u organizaciones no forma parte de esta épica.

## Historias y aceptación

Los identificadores siguientes se asignaron a partir de la épica recibida; no se proporcionaron identificadores oficiales.

| Historia               | Criterios implementados                                                                                                                                      | Evidencia de prueba                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| HU-01 Registro         | Nombre, correo válido y contraseña de 12–128 caracteres; correo único normalizado; rol lector; contraseña almacenada con scrypt y salt individual            | Casos HU-01 y registro en navegador                       |
| HU-02 Inicio de sesión | Credenciales verificadas, rechazo genérico de credenciales inválidas y usuarios inactivos, sesión de 8 horas, límite de intentos                             | Casos HU-02, sesión expirada y cookies                    |
| HU-03 Cierre de sesión | Eliminación de la sesión del servidor y cookie expirada; reutilizar la cookie devuelve 401                                                                   | Caso HU-03 y navegador                                    |
| HU-04 Administración   | Lista y búsqueda, asignación de cuatro roles, activación/desactivación, revocación de sesiones, protección de acceso administrativo                          | Casos HU-04 y cambio de rol desde interfaz                |
| HU-05 Permisos         | Matriz editable por rol, validación de códigos, protección del rol administrador, aplicación inmediata mediante revocación                                   | Casos HU-05 y edición desde interfaz                      |
| HU-06 Autorización     | Menús y acciones según permisos; el servidor valida cada ruta; anónimos reciben 401 y usuarios sin permiso 403                                               | Matriz de API, inventario y comprobación 403 en navegador |
| HU-07 Trazabilidad     | Registro de actor, acción, objetivo, IP y fecha para registro, sesiones, cambios de acceso, accesos denegados y operaciones de alimentos; consulta protegida | Caso HU-07 y pantalla Actividades                         |

## Pruebas y evidencia

```sh
npm test
```

Resultado de la entrega: **24 pruebas HTTP aprobadas**. GitHub Actions no inició sus pasos por un bloqueo de facturación/límite de gasto de la cuenta; el resultado remoto de las pruebas queda sin verificar. Consulta [el informe de verificación](docs/VERIFICACION.md). [Salida de pruebas](test-results.txt).

Para reproducir las verificaciones de navegador, con la aplicación de demostración ejecutándose y cuentas recién creadas:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

Playwright se usa únicamente como herramienta de desarrollo. El script comprueba registro, inicio/cierre de sesión, asignación de roles, edición de permisos, creación y consumo de alimentos, reportes, controles restringidos al lector y el rechazo 403 por API. Genera capturas y un video en `docs/evidence`. La comprobación de desbordamiento del login usa anchos de 390, 768 y 1440 px. Consulta el [informe del navegador](docs/evidence/browser-results.json).

El límite de autenticación es ocho solicitudes de login/registro por IP y correo en 15 minutos. Para repetir la demostración automatizada muchas veces, utiliza una base de pruebas nueva con `DATABASE_PATH` y vuelve a ejecutar `npm run demo`; no desactives este control en un entorno real.

- [Login móvil](docs/evidence/01-login-mobile.png)
- [Administración de usuarios](docs/evidence/02-users-admin.png)
- [Roles y permisos](docs/evidence/03-roles-permissions.png)
- [Actividades](docs/evidence/04-audit.png)
- [Inventario del administrador](docs/evidence/05-inventory-admin.png)
- [Inventario restringido del lector](docs/evidence/06-reader-restricted.png)
- [Registro](docs/evidence/07-register.png)
- [Reportes del supervisor](docs/evidence/08-reports-supervisor.png)
- [Video de demostración](docs/evidence/demo-foodsave.mp4)

El flujo completo para la exposición está en [docs/DEMO.md](docs/DEMO.md).

## Diseño y alcance

El login adapta el frame `4:25` de Figma a HTML/CSS con campos reales, conserva sus colores, composición móvil e iconos originales descargados localmente. El inventario toma como referencia el frame `4:267`. Las pantallas de administración se diseñaron para este incremento, ya que no aparecen en el prototipo. No se modificó el archivo de Figma.

Los alimentos, filtros, consumo/descarte e indicadores usan SQLite; no dependen de valores simulados en el navegador. Las estadísticas cuentan registros de alimentos, no suman sus cantidades. La consulta de actividades muestra los últimos 200 eventos; el historial de alimentos muestra los últimos 100 procesados.

La entrega incluye instrucciones reproducibles y un entorno local; no representa un despliegue público. Recuperación por correo, verificación de correo, MFA, notificaciones externas, separación por organizaciones y el resto del producto completo quedan fuera del incremento. El enlace de ayuda de contraseña informa que se debe contactar al administrador; no envía correos.

## Estructura y controles

- `server.mjs`: HTTP, autenticación, CSRF, RBAC, API y archivos públicos con lista permitida.
- `store.mjs`: esquema SQLite, roles, scrypt y selección segura de campos.
- `public/`: interfaz adaptable sin framework, recursos originales de Figma.
- `seed.mjs` / `demo.mjs`: administrador inicial y datos locales de demostración.
- `test/access.test.mjs`: pruebas de integración HTTP con bases independientes en memoria.
- `scripts/browser-check.cjs`: demostración automatizada y evidencias.
- `.github/workflows/ci.yml`: pruebas HTTP y de navegador para push y pull request.

Las consultas usan parámetros SQL. Las sesiones tienen tokens aleatorios de 256 bits almacenados como SHA-256 en el servidor. Las cookies usan `HttpOnly` y `SameSite=Strict`; las mutaciones requieren origen autorizado, JSON y token CSRF (excepto registro/login, que validan el origen). Hay límite de tamaño de solicitud, límite de intentos persistido en SQLite, CSP y escape de los valores mostrados en HTML. Las contraseñas y tokens no aparecen en respuestas ni en la bitácora.

La bitácora no tiene API de edición/borrado; un operador con acceso directo al archivo SQLite puede modificarlo. Para producción se requieren HTTPS, control del acceso al archivo de datos, copias de seguridad y una política de conservación de actividades. La validación local y el resultado de CI deben distinguirse: consulta el estado real de Actions para confirmar su ejecución remota.
