# Verificación ejecutada · Gestión de Negocios

Fecha: **26 de noviembre de 2026**, zona de presentación America/Santo_Domingo.

## Pruebas de API y regresión

Comando: npm test. Resultado local: **90 aprobadas / 90 ejecutadas, 0 fallidas, 0 omitidas**. Incluye las 76 pruebas de funcionalidades anteriores y 14 casos nuevos en test/business.test.mjs.

| Casos nuevos | Validación y resultado |
| --- | --- |
| GN-01 | Alta, edición, filtros, responsable elegible, ODS y versión: aprobado |
| GN-02 | Ciclos de negocio/proyecto, fechas y cierre con pendientes: aprobado |
| GN-03 | Tres dimensiones, ODS asociados y FK de proyecto del mismo negocio: aprobado |
| GN-04 | Evidencia, fecha, correcciones, orden cronológico, progreso decreciente e idempotencia: aprobado |
| GN-05 | Avance ascendente, límites y ausencia de medición: aprobado |
| GN-06 | Software, recursos, referencias y contratos inválidos/duplicados: aprobado |
| GN-07 | Usuario/equipo/área, capacidad, liberación, reintentos y cupos mínimos: aprobado |
| GN-08 | Dos solicitudes concurrentes por el último cupo: una 201 y otra 409; aprobado |
| GN-09 | Vigencia inclusiva, futura/vencida, renovación, deshabilitación y filtros: aprobado |
| GN-10 | Destinos inválidos/inactivos o varios destinos: aprobado |
| GN-11 | CSV de impacto/uso/vencimiento con filtros y protección de fórmulas: aprobado |
| GN-12 | Matriz de roles, anónimos, permisos, CSRF y origen: aprobado |
| GN-13 | Fallo inducido de historial revierte negocio y vínculos ODS: aprobado |
| GN-14 | Reinicio/migración preserva inventario, catálogo y personalización de permisos: aprobado |

## Prueba del flujo en navegador

Comando: npm run test:business:browser. Resultado: **aprobado en Chromium** con base aislada en memoria y datos sintéticos. No llama a servicios de terceros.

Se crearon negocio, proyecto e indicadores económicos/sociales/ambientales con mediciones y fuente. Se descargó el CSV de impacto. Se registró software, equipo y área; se asignaron tres cupos a los tres tipos de destino. Al agotarlos, se comprobó la ausencia de acción de asignación y el rechazo 409 de una llamada directa. Se liberó una asignación, se renovó un contrato y se comprobó el filtro de próximos vencimientos. Se descargaron los dos CSV de licencias y se consultaron los historiales. Se verificaron perfiles de administrador, supervisor, editor y lector, sin errores JavaScript.

Se verificaron las vistas de detalle de ambos módulos en 320×568, 390×844, 768×800 y 1440×900, sin desborde horizontal y con cierre de sesión visible.

## Adaptación responsive de la aplicación

Comando: npm run test:responsive. Resultado: **aprobado en ocho tamaños y doce módulos**: Mi espacio, Usuarios, Roles y permisos, Actividades, Inventario, Reportes, Operaciones, Logística, Finanzas, Escanear productos, Negocios e impacto y Software y licencias. Se comprueba cierre de sesión visible/pulsable al inicio y final de la página, menú móvil, Escape y ausencia de desborde.

## Evidencia visual nueva

| Archivo | Contenido |
| --- | --- |
| [01-indicadores-impacto.png](evidence/01-indicadores-impacto.png) | Tres dimensiones ODS, valores, metas, progreso y evidencia |
| [02-historial-negocio.png](evidence/02-historial-negocio.png) | Acciones, responsable y fecha en negocio |
| [03-asignaciones-sin-cupos.png](evidence/03-asignaciones-sin-cupos.png) | Usuario/equipo/área y capacidad agotada |
| [04-renovacion-y-vigencias.png](evidence/04-renovacion-y-vigencias.png) | Consulta de contrato renovado y próximos vencimientos |
| [05-historial-licencia.png](evidence/05-historial-licencia.png) | Creación, asignación, liberación y renovación |
| [06-negocios-movil.png](evidence/06-negocios-movil.png) | Portafolio en móvil |
| [07-licencias-movil.png](evidence/07-licencias-movil.png) | Licencias en móvil |
| [08-perfil-supervisor.png](evidence/08-perfil-supervisor.png) | Consulta/reporte sin acciones de administración |

Las capturas provienen del flujo real de la aplicación con registros ficticios. El repositorio incluye workflow de GitHub Actions que repite API y los recorridos de navegador y publica las evidencias como artifact. El resultado remoto específico de la entrega se registra en GITHUB.txt del paquete; la existencia del workflow por sí sola no significa que una ejecución haya aprobado.

## Preservación de la instalación local

Antes de iniciar la versión nueva se respaldó SQLite fuera del repositorio. Se conservaron cinco usuarios, siete alimentos, ocho movimientos logísticos y cero movimientos financieros existentes. La nueva funcionalidad no altera cantidades ni costos de inventario. Se verifica integridad con PRAGMA foreign_key_check.


## Grabación pausada del flujo

Se añadió [el video de Negocios y Licencias](VIDEO.md), con 28 etapas, rótulos y pausas de lectura. El ensayo y la grabación definitiva completaron negocio y proyecto, registró tres dimensiones y mediciones, asignó tres cupos, liberó uno y renovó la licencia conservando dos asignaciones activas. Se verificaron las descargas de los tres CSV y el perfil de supervisor sin acciones de administración, sin errores JavaScript. El MP4 dura 417.72 segundos, usa H.264 a 1440×1000 e incluye 28 capítulos. Su decodificación completa pasó sin errores y se revisaron 14 muestras de imagen del recorrido. Los resultados se documentan en [video-verification.json](evidence/video-verification.json).
