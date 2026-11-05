# Épica · Gestión Operativa de FoodSave

Compromiso del enunciado: **5 de noviembre de 2026 a las 20:00, America/Santo_Domingo**.

## Alcance adaptado

Como administrador, editor y supervisor de FoodSave, necesitamos crear, consultar, actualizar y cerrar operaciones de consumo o descarte de alimentos, con responsables definidos, reglas de inventario y trazabilidad de los cambios.

El objetivo es coordinar el trabajo de cocina y control de alimentos, evitar descuentos duplicados o cantidades negativas y disponer de un reporte verificable de las operaciones realizadas. Se conserva la autenticación y la administración de usuarios y accesos del incremento anterior.

## Flujo y reglas

1. Se crea una operación **Pendiente**, con título, tipo, alimento, cantidad, responsable activo, fecha prevista y notas opcionales.
2. Se puede editar mientras esté pendiente o en proceso. Cada cambio conserva sus valores anteriores y nuevos.
3. Una operación pendiente pasa a **En proceso** mediante Iniciar operación.
4. Un usuario con permiso de cierre la marca **Cerrada** e incluye una observación de 5–1000 caracteres. El cierre descuenta la cantidad del inventario en la misma transacción que registra estado, historial y auditoría.
5. Una operación pendiente o en proceso puede **Cancelarse** con un motivo de 5–1000 caracteres. Cancelar no descuenta inventario.
6. Cerrada y Cancelada son estados definitivos: no se editan, reabren ni eliminan por API.

Las cantidades son enteros positivos de hasta 10 000 unidades. El alimento debe estar disponible y tener existencias suficientes. El responsable debe estar activo y conservar `operations.manage`; se valida al crear, editar, iniciar y cerrar. Si deja de estar habilitado se debe reasignar la operación antes del cierre.

El consumo de alimentos vencidos está bloqueado y su fecha prevista no puede superar el vencimiento. El descarte de alimentos vencidos está permitido. Se aceptan fechas previstas pasadas para organizar trabajo atrasado; la elegibilidad de un consumo se vuelve a comprobar con la fecha actual al cerrar.

**Las operaciones pendientes o en proceso no reservan existencias.** Si otra operación o una acción del inventario utiliza el alimento, el cierre se rechaza si ya no hay cantidad suficiente. Se debe ajustar o cancelar la operación. Una operación puede cerrarse antes de su fecha prevista si se cumplen las reglas.

El cierre parcial mantiene el alimento disponible con la cantidad restante. Si agota existencias, la cantidad restante pasa a cero y el alimento se clasifica como consumido o descartado según la operación. Las unidades procesadas quedan registradas en la operación y su historial. Las estadísticas anteriores de alimentos continúan contando registros completos, mientras este reporte informa unidades por operación.

Cada modificación exige `expected_version`. Una revisión desactualizada recibe 409 y obliga a actualizar la consulta. Esto evita que dos usuarios sobrescriban cambios y que un doble clic cierre o descuente dos veces. Dos operaciones que compiten por el mismo inventario no pueden dejar existencias negativas.

## Perfiles y permisos predeterminados

| Perfil        | Consultar | Crear / actualizar / iniciar / cancelar | Cerrar | Reportar |
| ------------- | --------- | --------------------------------------- | ------ | -------- |
| Administrador | Sí        | Sí                                      | Sí     | Sí       |
| Editor        | Sí        | Sí                                      | No     | No       |
| Supervisor    | Sí        | No                                      | Sí     | Sí       |
| Lector        | No        | No                                      | No     | No       |

Permisos: `operations.read`, `operations.manage`, `operations.close`, `operations.report`. El administrador puede cambiar la matriz desde Roles y permisos. La separación de ejecución y cierre permite que un editor prepare y un supervisor confirme; el administrador puede completar el flujo entero.

El módulo representa un espacio de trabajo compartido. Un editor autorizado puede gestionar operaciones de otros responsables; el responsable es un dato operativo y un filtro, no una regla de propiedad individual. El historial registra quién realizó realmente cada acción.

## Historias terminadas y aceptación

Los códigos GO se asignaron a este incremento; el enunciado no proporcionó identificadores individuales.

| Historia                             | Criterios de aceptación implementados                                                                                                                                                                                                                               | Evidencia                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GO-01 Crear operaciones              | Alta pendiente con campos obligatorios, tipo válido, alimento disponible, cantidad suficiente, responsable activo habilitado, fecha real y consumo antes del vencimiento. Una solicitud inválida no crea operación ni historial.                                    | `test/operations.test.mjs`: creación y validaciones; `02-operation-created.png`          |
| GO-02 Consultar operaciones          | Lista y detalle; filtros combinables por estado, rango inclusivo de fecha prevista y responsable. Rechazo de rangos invertidos, fechas inexistentes, claves duplicadas y parámetros desconocidos. Estado vacío si no hay coincidencias.                             | Pruebas de filtros; `05-filtered-operations.png`                                         |
| GO-03 Actualizar operaciones         | Edición y reasignación de operaciones abiertas; validación en servidor; incremento de versión; cambios anteriores/nuevos visibles; revisión desactualizada devuelve 409.                                                                                            | Pruebas de actualización/reasignación; `03-operation-in-progress.png`                    |
| GO-04 Iniciar, cerrar y cancelar     | Transiciones válidas; observación obligatoria para cierre/cancelación; cierre atómico con inventario; doble cierre y competencia por cantidades rechazados; estados definitivos inmutables; cancelación sin descuento.                                              | Pruebas de negocio y concurrencia; `04-closed-history.png`, `07-cancelled-operation.png` |
| GO-05 Historial de cambios           | Creación, edición, inicio, cierre y cancelación guardan actor, fecha, acción, revisión anterior/nueva y observación. Consulta en el detalle y eventos en Actividades. No hay API de edición/borrado del historial.                                                  | Prueba de historial/auditoría; `04-closed-history.png`                                   |
| GO-06 Reporte básico                 | CSV descargable y versión imprimible para guardar PDF. Utilizan los filtros aplicados, muestran totales por estado y detalle completo, sin límite de 100 filas. CSV protegido contra fórmulas y HTML escapado. Generación auditada.                                 | Pruebas de reportes, descarga real en Chromium y `06-operations-report.png`              |
| GO-07 Accesos y seguridad            | Menú/acciones según permiso y validación independiente en cada ruta. 401 para anónimos, 403 para perfiles sin permiso; CSRF para mutaciones. Editor sin cierre y lector sin consulta/reporte.                                                                       | Matriz HTTP y demostración de navegador con rechazos 403                                 |
| GO-08 Actualización de instalaciones | Migración idempotente, conserva usuarios, alimentos y permisos previos; añade tablas y permisos operativos iniciales una sola vez. Revoca sesiones de los perfiles actualizados. Reejecutar no restaura permisos que un administrador haya retirado posteriormente. | Prueba de migración desde esquema previo y reapertura                                    |

## Consultas, fechas e historial

Los filtros `from` y `to` se refieren a **fecha prevista de la operación**, no a creación o cierre. Se incluyen ambos extremos. El selector conserva responsables históricos aunque hayan dejado de estar activos. La asignación solo admite responsables actualmente habilitados.

Fechas previstas: `YYYY-MM-DD`. Fechas de eventos almacenadas por SQLite: UTC; la interfaz las muestra en America/Santo_Domingo. La fecha de generación del reporte se muestra en Santo Domingo; creación/cierre del detalle CSV están identificados como UTC.

La lista, el historial por operación y los reportes devuelven todas las coincidencias. El volumen esperado es el de esta instalación local; no se añadieron paginación ni procesos de reporte en segundo plano.

La API no permite alterar historial, pero alguien con acceso directo al archivo SQLite podría hacerlo. Se conserva el modelo de permisos y el ámbito de una sola instalación del incremento anterior.

## API del incremento

| Método / ruta                     | Permiso           | Función                                                      |
| --------------------------------- | ----------------- | ------------------------------------------------------------ |
| GET `/api/operations`             | operations.read   | Lista filtrada                                               |
| GET `/api/operations/options`     | operations.read   | Alimentos disponibles, responsables habilitados e históricos |
| POST `/api/operations`            | operations.manage | Crear pendiente                                              |
| GET `/api/operations/:id`         | operations.read   | Detalle e historial                                          |
| PATCH `/api/operations/:id`       | operations.manage | Editar con expected_version                                  |
| POST `/api/operations/:id/start`  | operations.manage | Iniciar con expected_version                                 |
| POST `/api/operations/:id/close`  | operations.close  | Cerrar con expected_version y note                           |
| POST `/api/operations/:id/cancel` | operations.manage | Cancelar con expected_version y note                         |
| GET `/api/operations/export.csv`  | operations.report | CSV de todas las coincidencias                               |
| GET `/api/operations/print`       | operations.report | Reporte imprimible de todas las coincidencias                |

Lista y reportes aceptan `status`, `from`, `to`, `responsible_id`. Los controles de SQL usan parámetros. No se incorporó DELETE porque el historial operativo debe conservarse.

## Ejecutar y migrar

Con Node.js 24 o posterior:

```sh
npm run demo
npm run demo:operations
npm start
```

Abre http://localhost:3000. Si el puerto está ocupado, usa `PORT=3002 npm start` y abre http://localhost:3002. El origen predeterminado se ajusta al puerto. Las cuentas nuevas se generan con contraseñas aleatorias y se guardan localmente en `.demo-credentials.json`.

En una instalación existente, iniciar el servidor aplica la migración automáticamente. No hace falta borrar SQLite ni recrear cuentas. Los perfiles administrador, editor y supervisor deben volver a iniciar sesión después de la primera actualización. Los permisos anteriores se conservan y se agregan los operativos de la tabla inicial; el lector no recibe acceso nuevo.

`npm run demo:operations` añade un alimento vigente y dos operaciones pendientes de ejemplo solo si no existen operaciones. No cambia alimentos o cuentas existentes. No lo ejecutes si deseas una base sin ejemplos. Las fechas de ejemplo se calculan al ejecutar el comando.

## Demostración y evidencias

- [Guion de demostración](DEMO.md).
- [Informe de verificación](VERIFICACION.md).
- [Resultado del navegador](evidence/browser-results.json).
- [Video](evidence/demo-operaciones.mp4).
- Capturas en `docs/operations/evidence/`: vista inicial, creación, actualización/inicio, cierre/historial, filtros, reporte, cancelación y móvil.

Los datos de las evidencias se generaron en una base en memoria, independiente de la instalación local. Las fechas 2099 de las pruebas son datos deliberados para que los alimentos de prueba no caduquen al repetirlas; la demostración local usa fechas calculadas al ejecutar `demo:operations`.
