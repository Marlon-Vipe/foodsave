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
