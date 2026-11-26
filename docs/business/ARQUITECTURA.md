# Arquitectura, API y datos · Gestión de Negocios

## Diseño técnico

FoodSave es un monolito modular de tres capas, ejecutado en un proceso Node.js 24+:

1. **Presentación:** public/app.js monta el menú y aplica permisos; public/businesses.js y public/licenses.js gestionan formularios, filtros y detalle. public/business-ui.js comparte campos, escape HTML, conversiones monetarias e historial. public/style.css adapta escritorio y móvil. Las llamadas fetch usan rutas del mismo origen; no hay una API remota nueva.
2. **Aplicación/dominio:** server.mjs valida sesión, origen, CSRF y JSON, y despacha al módulo correspondiente. businesses.mjs implementa negocios, proyectos, ODS, mediciones y CSV. licenses.mjs calcula vigencias, cupos, asignación, renovación y reportes. business-utils.mjs concentra validación, control de versión e historial.
3. **Persistencia:** store.mjs abre SQLite con FK, WAL y busy_timeout; business-store.mjs aplica esquema/migración business-v1. Consultas SQL parametrizadas. BEGIN IMMEDIATE hace atómicas escritura, comprobación de cupos e historial.

Flujo: navegador → API HTTP del mismo servidor → sesión/permisos/CSRF → validación de dominio → transacción SQLite → historial/auditoría → JSON → pantalla. CSV sale de la misma capa de dominio, con autorización específica de reporte.

La autenticación existente usa scrypt con salt y sesiones cuyo token se almacena como hash. Cookies HttpOnly/SameSite, y Secure bajo HTTPS. No se incorporó otro sistema de identidad. Los dos módulos no dependen de OpenAI, OCR ni pagos externos. La conexión opcional a OpenAI pertenece al incremento anterior de Finanzas/OCR y no participa en estos recorridos.

## Modelo de datos y relaciones

| Entidad | Datos y relaciones |
| --- | --- |
| users / roles | Identidad existente, estado activo, permisos. Referenciada por responsables, actores y destinatarios. |
| sdgs | Catálogo de 17 objetivos, PK id 1–17. |
| businesses | Tipo iniciativa/producto/servicio, responsable FK users, estado, presupuesto centavos, moneda, versión y fecha de creación. |
| business_sdgs | Relación N:M negocio/ODS, PK compuesta y ambas FK. |
| business_projects | N:1 negocio, N:1 responsable; inicio/fin, estado y versión; UNIQUE(id,business_id). |
| business_indicators | N:1 negocio, ODS, proyecto opcional; dimensión, unidad, base, meta y fecha límite. FK (project_id,business_id) impide proyectos ajenos; FK (business_id,sdg_id) obliga a un ODS asociado. |
| indicator_measurements | N:1 indicador, valor, fecha de medición, fuente, actor y fecha de registro; request_id único. Historial por adición. |
| business_history | N:1 negocio y actor; acción, antes/después JSON y fecha. Incluye sus entidades subordinadas. |
| business_software | Catálogo único por nombre/proveedor, con comparación NOCASE. |
| license_targets | Equipos o áreas; únicos por tipo/nombre. |
| business_licenses | N:1 software, negocio opcional, referencia única, cupos, vigencia, habilitación, costo centavos/moneda y versión. |
| license_assignments | N:1 licencia; FK user_id o target_id, exactamente una no nula; cupos, asignador/fecha, liberador/fecha/motivo, request_id único. |
| license_history | N:1 licencia y actor, antes/después JSON, acción, motivo y fecha. |
| audit | Bitácora global existente para accesos, catálogo, eventos de negocio/licencia y exportaciones. |

La ausencia de ON DELETE CASCADE preserva referencias ante borrados accidentales. CHECK restringe tipos, estados, cantidades, fechas ordenadas y destino exclusivo. Índices parciales únicos evitan destinos con varias asignaciones activas; índices por padre y fecha soportan consulta de detalle y última medición. Capacidad disponible = cupos − suma de asignaciones no liberadas, únicamente si el contrato está vigente/habilitado; en otro caso es cero. Se vuelve a consultar dentro de la transacción para evitar sobreasignación.

Las fechas civiles usan YYYY-MM-DD y la fecha actual de America/Santo_Domingo. Vencimiento es inclusivo. Los timestamps de registro de SQLite se muestran con etiqueta UTC. Vigencia y progreso se calculan al consultar, sin procesos programados que puedan dejar estados desactualizados.

## API implementada

Todas las rutas requieren sesión. GET de dominio requiere el permiso read del módulo. POST/PATCH requiere además manage; los CSV requieren report. La API recibe cuerpos estrictos: rechaza campos desconocidos o incompletos. expected_version es obligatorio en actualizaciones versionadas. request_id es obligatorio para mediciones y asignaciones.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | /api/businesses/options | Catálogo ODS y responsables activos elegibles |
| GET / POST | /api/businesses | Filtrar negocios / crear borrador |
| GET / PATCH | /api/businesses/:id | Detalle completo / actualizar datos y estado |
| POST | /api/businesses/:id/projects | Crear proyecto |
| PATCH | /api/businesses/projects/:id | Editar proyecto y estado |
| POST | /api/businesses/:id/indicators | Definir métrica |
| POST | /api/businesses/indicators/:id/measurements | Registrar medición con evidencia |
| GET | /api/businesses/export.csv | Portafolio e impacto, filtros status y sdg_id |
| GET | /api/licenses/options | Software, usuarios activos, equipos/áreas y negocios |
| POST | /api/licenses/software | Registrar software/proveedor |
| POST | /api/licenses/targets | Registrar equipo o área |
| GET / POST | /api/licenses | Filtrar / registrar contratos |
| GET / PATCH | /api/licenses/:id | Detalle / renovar, modificar cupos, asociación, costo o habilitación |
| POST | /api/licenses/:id/assignments | Asignar cupos a un destino |
| POST | /api/licenses/assignments/:id/release | Liberar con motivo |
| GET | /api/licenses/export.csv | Reporte de vigencias, disponibilidad y costo |
| GET | /api/licenses/usage.csv | Reporte de asignaciones y liberaciones |

Filtros de licencias: state = valid/expired/scheduled/disabled/expiring, days = 1–365, software_id y business_id. Los reportes respetan los mismos filtros de sus listas. La edición de licencia conserva el software: un contrato de otro software debe registrarse por separado. No almacena claves secretas de activación.

Respuestas: 400 datos inválidos, 401 falta/expiración de sesión, 403 permisos/CSRF/origen, 404 inexistente, 409 conflicto de versión, transición, cupos o duplicado, 405 método no permitido en detalles y 500 mensaje genérico sin SQL interno. Catálogos nuevos generan 201 y lecturas/ediciones 200. Reintentos idempotentes de creación devuelven el ID original con 201.

## Permisos y actualización

| Rol inicial | business.read | business.manage | business.report | licenses.read | licenses.manage | licenses.report |
| --- | --- | --- | --- | --- | --- | --- |
| Administrador | Sí | Sí | Sí | Sí | Sí | Sí |
| Editor | Sí | Sí | No | Sí | Sí | No |
| Supervisor | Sí | No | Sí | Sí | No | Sí |
| Lector | No | No | No | No | No | No |

business-v1 agrega estos permisos mediante unión con los existentes y revoca sesiones de los tres perfiles afectados una sola vez. Reinicios posteriores no restauran permisos modificados por el administrador. La asignación de un responsable no cambia sus permisos.

## Decisiones y crecimiento

Se reutiliza la arquitectura nativa para mantener ejecución local simple y responsabilidades separadas. Los índices, WAL y transacciones sirven al alcance académico y un espacio compartido. Las listas y exportaciones se procesan completas; el siguiente paso ante un volumen alto sería paginación/streaming, métricas operativas y una base con soporte multiinstancia. Este incremento no afirma aislamiento multiempresa ni despliegue productivo de alta disponibilidad.
