# Guion · Gestión Operativa de FoodSave

Entrega solicitada: **5 de noviembre de 2026, 20:00, America/Santo_Domingo**.

## Preparación

1. Ejecuta `npm run demo` y `npm run demo:operations` con Node.js 24 o posterior.
2. Inicia `npm start` y abre http://localhost:3000. Si está ocupado, usa `PORT=3002 npm start` y abre http://localhost:3002.
3. Consulta las cuentas de administrador, editor y supervisor en `.demo-credentials.json`. Usa una ventana privada si quieres mostrar dos roles simultáneamente.
4. Para crear datos propios, registra primero un alimento vigente con al menos 10 unidades en Inventario.

## Demostración sugerida: 7–9 minutos

1. **Crear:** como editor o administrador, abre Operaciones. Crea un Consumo con título, alimento, cantidad 3, responsable editor activo y fecha prevista no posterior al vencimiento.
2. **Consultar:** abre Ver operación. Confirma Pendiente y el primer evento de historial con actor y fecha.
3. **Actualizar:** abre Editar operación y cambia el título, la cantidad a 4 o el responsable. Guarda y muestra valores anteriores/nuevos en el historial.
4. **Reglas:** intenta crear una cantidad mayor que las existencias o consumir después del vencimiento; el servidor debe rechazarlo. Una cantidad inválida no debe generar operación.
5. **Iniciar:** pulsa Iniciar operación. El estado pasa a En proceso. El inventario mantiene la cantidad porque todavía no se ha cerrado.
6. **Cerrar:** entra como supervisor, abre esa operación, escribe una observación de al menos cinco caracteres y pulsa Cerrar operación. Confirma Cerrada y el descuento de cuatro unidades en Inventario.
7. **Estado definitivo:** muestra que ya no hay edición/cierre en esa operación y que conserva creación, actualización, inicio y cierre con sus actores. Las pruebas HTTP verifican además que un doble cierre devuelve 409 y no descuenta dos veces.
8. **Cancelar:** como editor/administrador, crea una operación de Descarte y cancélala con motivo. Muestra Cancelada y que la cantidad del inventario no cambió.
9. **Filtros:** selecciona Cerrada, el rango de fecha prevista utilizado y el responsable. Aplica filtros y luego Limpiar. Prueba un rango sin coincidencias para mostrar el estado vacío.
10. **Reportar:** como supervisor/administrador, con filtros aplicados descarga CSV y abre Imprimir reporte de operaciones para guardar PDF. Comprueba que el detalle y los totales corresponden a la consulta.
11. **Accesos:** el editor crea y actualiza, pero no puede cerrar; el supervisor cierra y reporta, pero no crea; el lector no ve Operaciones. Los rechazos 403 por API están grabados en la evidencia automática.
12. **Trazabilidad:** como administrador, abre Actividades para mostrar los eventos operation.created/updated/started/closed/cancelled y operation.report.

## Validación reproducible

```sh
npm test
npm ci
npx playwright install chromium
npm run test:operations:browser
```

La prueba de navegador arranca su propio servidor temporal y una base en memoria. Graba el flujo y captura la interfaz sin usar datos de la instalación. El video final de entrega no incluye audio.
