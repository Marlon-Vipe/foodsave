# Verificación · Gestión Operativa de FoodSave

Fecha de validación: **5 de noviembre de 2026**, America/Santo_Domingo.

## Resultado local

- **53 pruebas HTTP aprobadas, 0 fallos:** las 31 anteriores y 22 casos operativos nuevos. Salida completa en `test-results.txt`; casos nuevos en `test/operations.test.mjs`.
- Cobertura nueva: creación, validaciones, actualización, reasignación, inicio, cierre, cancelación, estados definitivos, filtros combinados, historial, CSV/impresión, permisos, CSRF, migración y concurrencia.
- Dos peticiones de cierre para la misma revisión producen un éxito y un 409; solo se descuenta una vez. Dos operaciones que compiten por existencias no dejan cantidades negativas.
- La migración desde el esquema anterior conserva usuarios y permisos personalizados, añade los permisos operativos una vez y no repone concesiones retiradas posteriormente.

## Evidencia de navegador

Prueba reproducible: `npm run test:operations:browser`, con Playwright y Chromium instalados. El servidor temporal y la base de datos en memoria son independientes de la instalación del usuario.

La prueba pasó con los siguientes flujos:

1. Rechazo de una cantidad mayor que las existencias.
2. Creación de una operación pendiente.
3. Actualización del título/cantidad e inicio.
4. Editor sin control de cierre y petición directa rechazada con 403.
5. Cierre por supervisor, descuento exacto de unidades y operación definitiva.
6. Historial visible de creación, actualización, inicio y cierre, con actores y cambios.
7. Filtros combinados por estado, fecha prevista y responsable.
8. Descarga CSV real consistente con los filtros y reporte imprimible.
9. Consulta sin coincidencias y restablecimiento de filtros.
10. Cancelación con motivo sin descuento de inventario.
11. Lector sin módulo y rutas de consulta/reporte rechazadas con 403.
12. Sin errores JavaScript ni desbordamiento horizontal de la página en 390, 768 y 1440 px.

El resultado está en `evidence/browser-results.json`. Se revisaron visualmente las capturas de creación, cierre/historial, filtros, reporte y móvil.

El video `evidence/demo-operaciones.mp4` dura **43.8 segundos**, sin audio. Se redujo la velocidad de reproducción de la captura automatizada para facilitar su lectura; el WebM original se conserva. FFmpeg decodificó el MP4 completo sin errores.

## Instalación local

Antes de aplicar la migración se creó una copia local de SQLite fuera de los entregables. Se verificó que las seis cuentas y los seis alimentos anteriores se conservaron; el comando explícito `demo:operations` añadió un alimento vigente y dos operaciones pendientes de ejemplo.

Se comprobó el login real del administrador y la consulta de operaciones con respuestas 200, y se cerró la sesión de verificación. FoodSave quedó iniciado en **http://localhost:3002** porque el puerto 3000 estaba ocupado por Vipe OS. El comando reproducible general sigue siendo `npm start` o `PORT=3002 npm start` para ese caso.

La primera migración revoca las sesiones de los perfiles administrador, editor y supervisor, por lo que deben autenticarse otra vez. El paquete para compartir no incluye bases, respaldos, sesiones ni contraseñas locales.

## Repositorio y validación remota

El código se integró en `main` de [Marlon-Vipe/foodsave](https://github.com/Marlon-Vipe/foodsave), commit funcional `85f087a1167c2948fe647254f557af5e0800e6c5`.

**GitHub Actions aprobado:** [ejecución 42016120389](https://github.com/Marlon-Vipe/foodsave/actions/runs/42016120389). El workflow completo terminó con success, incluida la suite HTTP y las verificaciones de navegador configuradas para accesos, reportes y operaciones. Los bloqueos de facturación que figuran en los informes anteriores no impidieron esta ejecución.

El cierre de la entrega actualiza este informe y elimina una grabación temporal de la pestaña de impresión; no modifica la lógica de negocio validada. El entorno entregado es local y no se realizó un despliegue público.
