# FoodSave · Finanzas, OCR e IA

La ampliación permite registrar costos de alimentos, controlar el gasto mensual, valorar pérdidas potenciales, registrar ayudas recibidas y preparar productos desde una imagen.

## Historias y criterios

| ID | Historia | Criterios verificables |
|---|---|---|
| FI-01 | Registrar costos | Inventario y Logística admiten costo unitario en RD$ y fecha de compra. La entrada guarda su importe en la misma transacción del lote y movimiento. Una reposición usa el costo de ese lote; para otro precio se registra otro lote. |
| FI-02 | Consultar gasto y existencias | Finanzas separa compras, gastos adicionales, ayudas, inventario valorado, valor vencido y descartes del mes. Una salida no vuelve a sumar el gasto de compra. Los importes usan centavos enteros. |
| FI-03 | Estimar posibles pérdidas | Se calcula cantidad actual × costo unitario de los lotes que vencen entre hoy y siete días. Los vencidos aparecen separados. El descarte confirmado registra la pérdida realizada. Los datos sin costo quedan pendientes y los totales se indican como parciales. |
| FI-04 | Gestionar presupuesto y ayudas | Se configura presupuesto mensual y se registran gastos y ayudas/donaciones/subsidios ya recibidos. Disponible = presupuesto + ayudas − gastos. El gasto cubierto por el usuario es el máximo entre cero y gasto menos ayudas. Los registros son idempotentes y el presupuesto usa control de versión. |
| FI-05 | Descargar reportes | El CSV financiero incluye cálculos, movimientos y registros económicos del mes. Respeta permisos y neutraliza fórmulas en datos de usuario. |
| FI-06 | Obtener sugerencias de ahorro | El botón de IA usa un resumen calculado y alimentos próximos a vencer. Las sugerencias no modifican registros. El cálculo de importes pertenece al servidor. |
| IA-01 | Leer una foto mediante OCR y LLM | OpenAI lee PNG/JPEG/WebP y devuelve texto, productos, categorías, cantidades, precios y fechas reconocidos. Los datos ausentes quedan pendientes. La foto se envía al solicitar el análisis. |
| IA-02 | Revisar y registrar | Se pueden corregir o quitar productos y confirmar entre 1 y 20 lotes. Se reutilizan las validaciones del registro manual. La confirmación es atómica y reintentar no duplica existencias ni gasto. |
| IA-03 | Proteger y recuperar | La clave permanece en el servidor. Cada lectura pertenece al usuario que la inició. Se verifican imagen, permisos y CSRF. Los errores permiten reintentar. La revisión vence tras 30 minutos. |
| IA-04 | Respetar roles y datos previos | Administrador tiene acceso completo. Editor registra costos, presupuesto y ayudas y usa el escáner. Supervisor consulta, exporta y solicita sugerencias. Lector conserva Inventario. La migración mantiene cantidades e historial anteriores. |

## Cálculos y datos anteriores

La moneda inicial es **DOP (RD$)**. Los costos corresponden a las unidades enteras de inventario; las ventas por peso deben revisarse. El costo puede ser cero para un producto gratuito o quedar pendiente cuando se desconoce.

Completar un costo de un lote anterior permite valorar sus existencias actuales. Los movimientos anteriores permanecen sin precio y no se convierten en compras nuevas. Cada movimiento nuevo conserva una copia del costo.

Gastos y ayudas se filtran por mes. Riesgo e inventario describen las existencias actuales. Las fechas usan Santo Domingo. Una compra con fecha informada se registra en ese día. Las ayudas representan importes informados como recibidos.

## Arquitectura

HTML/CSS/JavaScript → API Node.js → reglas, permisos y SQLite. El cliente de OpenAI reside en el servidor.

| Módulo | Responsabilidad |
|---|---|
| finance-store.mjs | Migración, cálculo y captura de costos. |
| finance.mjs | Presupuesto, registros económicos y CSV. |
| inventory-service.mjs | Alta compartida por registro manual e importación. |
| product-imports.mjs | Lectura, revisión y confirmación. |
| ai-service.mjs | Responses API con imágenes y salidas estructuradas. |
| finance-ai.mjs | Sugerencias basadas en datos calculados. |

| Tabla | Integridad y función |
|---|---|
| lot_costs | Un costo por lote, referencia a foods y al usuario responsable. |
| financial_movements | Clave única por movimiento, referencia a stock_movements, copia del costo y clasificación. |
| monthly_budgets | Clave por mes, versión y usuario. |
| economic_records | Gastos y ayudas con fecha, responsable e identificador único de solicitud. |
| product_imports | Propietario, huella de imagen, estado, borrador y lotes confirmados. |
| ai_requests | Conteo de solicitudes por usuario. |

Las operaciones usan claves foráneas, restricciones, transacciones BEGIN IMMEDIATE y CSRF. Un error de importación o de costo revierte toda la operación. La imagen original se procesa en memoria. SQLite conserva su huella, texto y productos extraídos. Las solicitudes a OpenAI indican store=false.

## API

- GET /api/finance/summary?month=YYYY-MM
- GET /api/finance/export.csv?month=YYYY-MM
- PUT /api/finance/budget
- POST /api/finance/records
- POST /api/finance/lot-costs
- POST /api/finance/advice
- POST /api/imports/analyze
- POST /api/imports/confirm

POST /api/inventory añade los campos opcionales unit_cost_cents y purchased_on. Incluir costo requiere finance.manage.

## Ejecución

Requiere Node.js 24 o superior. El servidor usa módulos incluidos en Node.js; las pruebas de navegador usan Playwright.

    npm run demo
    PORT=3002 npm start

npm start carga .env si existe. La integración usa OPENAI_API_KEY y, opcionalmente, OPENAI_MODEL (gpt-4.1-mini por defecto). El archivo privado está excluido de Git y de la entrega. En una instalación sin clave funcionan los módulos manuales y la IA informa que falta configurar el servicio.

La clave de demostración se creó con caducidad de 30 días. Las peticiones duran como máximo 60 segundos y se limitan a 20 por usuario y hora. El navegador reduce fotos de hasta 15 MB; el servidor acepta una imagen procesada de hasta 3 MB. Si la moneda detectada es diferente de DOP o no está identificada, los costos quedan pendientes de revisión.

## Referencias oficiales

[Imágenes en Responses API](https://developers.openai.com/api/docs/guides/images-vision) · [Salidas estructuradas](https://developers.openai.com/api/docs/guides/structured-outputs) · [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
