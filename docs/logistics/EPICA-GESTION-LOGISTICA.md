# FoodSave · Gestión Logística

Fecha del mandato: **12 de noviembre de 2026, 20:00**, hora de Santo Domingo.

Como administrador de FoodSave, quiero que el equipo autorizado registre lotes, gestione sus entradas y salidas, y consulte el historial para saber qué alimentos hay disponibles y quién movió cada cantidad. El incremento reutiliza la autenticación, los roles y la auditoría de FoodSave.

## Historias y criterios de aceptación

| ID | Historia | Criterios de aceptación |
|---|---|---|
| GL-01 | Registrar y consultar recursos | Un usuario autorizado registra un lote de alimento con nombre, categoría, vencimiento y cantidad inicial entera. El lote aparece en Logística e Inventario; su cantidad inicial queda registrada como entrada. |
| GL-02 | Gestionar entradas y salidas | El usuario con permiso selecciona un lote, indica tipo, unidades y motivo o destino. Una entrada suma unidades y una salida resta; el saldo actualizado se refleja en Inventario. Una salida total cierra el lote como agotado por salida logística. |
| GL-03 | Validar disponibilidad | Se rechazan movimientos sobre lotes vencidos o cerrados, cantidades no enteras o menores a una, salidas por encima del saldo y reposiciones que superen 10 000 unidades por lote. Dos solicitudes simultáneas no producen existencias negativas. Un rechazo no genera un movimiento. |
| GL-04 | Consultar historial | Se muestra fecha y hora local, lote, tipo, cantidad, origen, motivo, responsable y saldo antes/después. Se puede filtrar por lote, tipo o fechas y recorrer el historial en páginas. |
| GL-05 | Generar reportes | Los perfiles autorizados descargan un CSV de existencias físicas y disponibles y otro de movimientos que respeta los filtros aplicados. Cada exportación queda auditada. |
| GL-06 | Controlar acceso | El servidor verifica sesión, permisos y, para escrituras, origen y token CSRF. Administrador puede operar y exportar; editor registra lotes y movimientos; supervisor consulta y exporta; lector no accede al módulo por defecto. |
| GL-07 | Compartir existencias con Operaciones | El alta y el retiro directo de Inventario y el cierre operativo se reflejan en el historial; un cierre registra una sola salida con referencia a la operación. Cambios de stock, historial y auditoría se confirman juntos. Cancelar una operación no cambia existencias. |
| GL-08 | Preservar datos al actualizar | La migración conserva alimentos y permisos anteriores; registra un saldo de apertura de lotes en inventario y no reconstruye eventos anteriores. Reiniciar la aplicación no duplica saldos ni restablece permisos modificados. |

El alcance cubre entradas y salidas de lotes de alimentos; el destino se documenta en el motivo. Las asignaciones, almacenes múltiples y reservas quedan fuera del incremento. Las operaciones pendientes se revalidan al cierre y no reservan existencias. Los vencidos conservan sus existencias físicas hasta su descarte, pero quedan excluidos de la disponibilidad para salida logística.

## Implementación

El navegador sirve HTML/CSS/JS de FoodSave; la vista Logística usa la misma API HTTP y sesión. Node.js aplica permisos y reglas, y SQLite conserva el saldo en `foods` y su historial en `stock_movements`. `operation_id` vincula una salida con su operación y es único. Las fechas de la vista y el filtro de movimientos usan el calendario de Santo Domingo. La migración `logistics-v1` asigna los permisos iniciales y revoca las sesiones de los roles a los que añade permisos.

| Endpoint | Permiso |
|---|---|
| `GET /api/logistics/stock` | `logistics.read` |
| `GET /api/logistics/movements` | `logistics.read`; acepta `food_id`, `type`, `from`, `to` y el cursor `before` |
| `POST /api/logistics/movements` | `logistics.read` y `logistics.move` |
| `GET /api/logistics/stock.csv` y `GET /api/logistics/movements.csv` | `logistics.read` y `logistics.report` |
| `POST /api/inventory` | `inventory.manage`; el formulario en Logística reutiliza este endpoint |

Para actualizar una instalación, realiza una copia consistente de SQLite antes del primer arranque con la nueva versión. La migración se aplica automáticamente. Los usuarios afectados pueden iniciar sesión de nuevo con sus credenciales anteriores.

## Ampliación · Panel de control logístico

| ID | Historia | Criterios de aceptación |
|---|---|---|
| GL-09 | Consultar el control logístico y priorizar salidas | Se muestran unidades disponibles, lotes por vencer, vencidos y entradas/salidas del día. Los movimientos del día usan el calendario de Santo Domingo y excluyen saldos de apertura. FEFO ordena lotes disponibles por vencimiento y luego ID; cada alimento y categoría tiene su propia prioridad. |
| GL-10 | Configurar mínimos y consultar alertas | Se configura un mínimo entero de 0 a 1 000 000 por alimento y categoría. Se agrupan nombres normalizados por Unicode NFKC, mayúsculas/minúsculas y espacios. El saldo disponible suma lotes vigentes; se alerta cuando es menor que el mínimo. Cero desactiva el aviso. El valor persiste al reiniciar, se audita y exige la versión actual para evitar sobrescrituras simultáneas. |
| GL-11 | Actuar desde alertas y prioridades | Los usuarios autorizados pueden preparar una entrada o salida con el lote seleccionado. Los vencidos abren el formulario de descarte en Operaciones con lote y cantidad. El usuario elige responsable y confirma su creación. Si el alimento está agotado o no admite reposición en un lote vigente, se prepara el registro de un lote nuevo. El supervisor consulta los datos y los mínimos. |

Los avisos de vencimiento abarcan hoy y los siguientes siete días. Los vencidos se distinguen visualmente y quedan fuera de las recomendaciones de salida. La disponibilidad considera que un alimento puede utilizarse durante su fecha de vencimiento. FEFO sirve como recomendación y permite que el usuario seleccione otro lote vigente.

Los mínimos emplean los permisos existentes: `logistics.read` para consultar, y `logistics.read` junto con `logistics.move` para configurar. Preparar un descarte requiere `operations.read` y `operations.manage`; su cierre conserva el permiso `operations.close`.

Se añaden `GET /api/logistics/dashboard` y `PUT /api/logistics/minimums`. El almacenamiento usa `stock_minimums`, con clave compuesta de alimento normalizado y categoría, referencia al usuario que configuró el mínimo, fecha y versión. La migración `logistics-dashboard-v1` es idempotente y conserva los datos anteriores.
