# Demostración en clase · FoodSave Logística

En la carpeta del proyecto, con Node.js 24 o superior:

```bash
npm run demo
PORT=3002 npm start
```

Abre [FoodSave](http://localhost:3002/) e inicia sesión con la cuenta de administrador que imprime el primer comando. Si la base de demostración ya existía, consulta `.demo-credentials.json` en la misma carpeta. No entregues ese archivo.

| Paso | Qué hacer | Qué mostrar |
|---|---|---|
| 1. Registrar el recurso | Abre **Logística → Registrar lote**. Registra “Arroz integral de clase”, categoría **Otros**, vencimiento futuro y cantidad **10**. | La tabla muestra 10 unidades. En historial se ve la entrada inicial **0 → 10**. |
| 2. Registrar una entrada | Elige el lote, selecciona **Entrada**, cantidad **5** y motivo “Reposición de despensa”. | El saldo sube a **15**. |
| 3. Probar una regla | Intenta una **Salida** de **20** con motivo “Entrega al comedor”. | Aparece “Existencias insuficientes para esta salida”. El saldo sigue en **15** y no hay un movimiento adicional. |
| 4. Registrar una salida | Corrige la cantidad a **4** y guarda. | Quedan **11** unidades; el historial muestra **15 → 11**, el motivo y quién la registró. |
| 5. Consultar y exportar | Filtra por el lote y tipo **Salida**. Pulsa **Aplicar filtros** y descarga **Movimientos CSV**. Descarga también **Existencias CSV**. | El primer archivo contiene las salidas del lote seleccionado; el segundo muestra las 11 unidades disponibles. |
| 6. Mostrar permisos | Cierra sesión y entra como supervisor. | Puedes consultar y descargar los reportes, pero no aparecen los formularios de alta y movimiento. |

Para explicar la integración: “Logística, Inventario y Operaciones comparten el saldo del lote. Cuando se cierra una operación de consumo o descarte, FoodSave descuenta las unidades y registra la salida en el mismo historial”.

Las capturas y los comandos de prueba están en [Verificación](VERIFICACION.md).

## Mostrar el panel de control

1. Registra dos lotes de **Arroz integral**, ambos en **Otros**. Usa una fecha de mañana para uno y una fecha dentro de seis días para el otro.
2. Vuelve al inicio de **Logística**. En **Próximas salidas** aparece primero el lote que vence mañana.
3. Abre **Mínimos por alimento** y configura un mínimo superior a la suma de ambos lotes. Guarda el valor y selecciona **Existencias bajas** en el filtro de alertas.
4. Usa **Registrar entrada** desde la alerta para preparar el movimiento. Introduce una cantidad y el motivo, y guarda. El panel se actualiza con el nuevo saldo.
5. Usa **Registrar salida** desde el primer lote de **Próximas salidas**. El formulario ya tiene seleccionado ese lote.
6. Si hay un lote vencido, usa **Preparar descarte**. FoodSave abre Operaciones con el lote, tipo y cantidad preparados. Selecciona el responsable y confirma la creación.
7. Pulsa **Actualizar panel** para volver a consultar existencias, alertas e historial.

El video de la entrega muestra el flujo original de Logística. Las capturas 06 a 09 de evidencia muestran la ampliación del panel, mínimos y preparación de descarte.

[Video del flujo original de Logística](evidence/FoodSave-Video-Gestion-Logistica.mp4) · [Capítulos del video](evidence/CAPITULOS-VIDEO.txt).
