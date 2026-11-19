# Verificación · Finanzas, OCR e IA

**76 pruebas de API y datos**: 66 regresiones anteriores y 10 casos nuevos.

Los nuevos casos verifican costos y movimientos sin duplicar gasto; valoración de riesgo y datos pendientes; presupuesto con versión; ayudas/gastos idempotentes; validación, permisos y CSV; reversión transaccional; revisión, confirmación y propiedad de importaciones; fallos recuperables y límite de IA; sugerencias sin mutaciones.

    npm test
    npm ci
    npx playwright install chromium
    npm run test:finance:browser
    npm run test:responsive

La prueba funcional de navegador usa respuestas de IA controladas y una base aislada. Verifica el recorrido de pantalla, los cálculos, la revisión de productos, el CSV y los perfiles. La prueba responsive incluye Finanzas y Escanear productos.

## OpenAI real

Se ejecutó npm run test:finance:live con una factura ficticia y una base en memoria. OpenAI leyó dos productos por visión/OCR, la confirmación registró RD$ 340 y el asistente generó sugerencias. Esta prueba requiere clave y consume API. GitHub usa la prueba controlada.

[Resultado real](evidence/live-ai-results.json) · [Factura ficticia](evidence/receipt-demo.png)

## Capturas

- [Finanzas y presupuesto](evidence/01-finanzas-presupuesto.png)
- [Revisión OCR](evidence/02-ocr-revision.png)
- [Gastos e importación](evidence/03-gastos-e-importacion.png)
- [Finanzas en móvil](evidence/04-finanzas-movil.png)
