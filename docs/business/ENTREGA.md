# FoodSave · Épica Gestión de Negocios

Fecha del mandato: **26 de noviembre de 2026, 20:00, America/Santo_Domingo**.

## Alcance implementado

El mandato contiene dos alcances: su descripción y rúbrica evalúan negocios, proyectos e impacto ODS; la demostración pide software y licencias. Este incremento implementa ambos en FoodSave, enlazando opcionalmente los contratos digitales a los negocios que apoyan.

- **Negocios e impacto:** iniciativas, productos y servicios con responsable, presupuesto, moneda, ODS, ciclo de vida, proyectos e indicadores económicos, sociales y ambientales. Mediciones con fecha, valor, fuente y actor; avance, alertas y reporte CSV.
- **Software y licencias:** catálogo de software/proveedores, equipos y áreas; contratos con vigencia, cupos y costo; asignación a usuarios, equipos o áreas; liberación con motivo; renovación, filtros de vencimiento, reportes de uso y vigencias e historial.
- Permisos por perfil y validación en API. Los módulos previos de inventario, operaciones, logística, finanzas e importación permanecen integrados.

FoodSave se vincula al ODS 12 mediante iniciativas que reduzcan desperdicios de alimentos, y puede asociar otros ODS pertinentes. La [meta 12.3 de Naciones Unidas](https://sdgs.un.org/goals/goal12) aborda la reducción de pérdidas y desperdicio alimentario. El catálogo contiene los 17 ODS. Cada indicador de esta aplicación es una métrica interna definida por el equipo; no representa una certificación ni una medición oficial de Naciones Unidas.

## Entregables y ubicación

| Entregable solicitado | Contenido de esta entrega |
| --- | --- |
| Repositorio integrado | [Marlon-Vipe/foodsave](https://github.com/Marlon-Vipe/foodsave), código y workflow de CI |
| Versión ejecutable | Node.js 24+, SQLite local y comandos de ejecución reproducibles, abajo |
| Historias y aceptación | [HISTORIAS.md](HISTORIAS.md), GN-01 a GN-14 |
| Pruebas y resultados | [VERIFICACION.md](VERIFICACION.md), test/business.test.mjs y scripts/business-browser-check.mjs |
| Evidencia | [Video pausado de 28 etapas](VIDEO.md) y [ocho capturas del flujo y perfiles](evidence/), con datos sintéticos de demostración |
| Documentación afectada | Este directorio y entrada de README; arquitectura, datos, API y guía de clase |
| Paquete transferible | FoodSave-Gestion-Negocios.zip, con código completo, documentación, capturas, GITHUB.txt y LEEME.txt; sin claves ni datos personales locales |

## Ejecución reproducible

Requiere Node.js 24 o superior con node:sqlite. No necesita servidor SQL, Docker, API de pago ni una clave de OpenAI para esta épica.

```sh
git clone https://github.com/Marlon-Vipe/foodsave.git
cd foodsave
npm run demo
npm start
```

Abrir **http://localhost:3000**. El comando demo imprime credenciales aleatorias y guarda únicamente en el equipo el archivo .demo-credentials.json. Si las cuentas existen conserva sus contraseñas. El registro público crea lectores, que no tienen acceso a estos dos módulos; usar la cuenta administrador o editor del comando demo.

En otro puerto:

```sh
PORT=3002 APP_ORIGIN=http://localhost:3002 npm start
```

Abrir exactamente el origen configurado. DATABASE_PATH permite elegir otra base. Al iniciar, la migración business-v1 agrega tablas y permisos sin borrar alimentos, usuarios o movimientos. Se revocan una vez las sesiones de administrador, editor y supervisor para incorporar sus permisos; deben iniciar sesión nuevamente. Respaldar app.sqlite antes de actualizar una instalación con datos reales. No ejecutar npm run demo para cambiar contraseñas existentes.

Para las pruebas, que usan bases aisladas:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:business:browser
npm run test:responsive
```

La captura automatizada se hace en bases en memoria con cuentas ficticias; no modifica la base de uso local. Para demostración presencial consultar [DEMO.md](DEMO.md).

## Correspondencia con la rúbrica

| Criterio | Puntos del mandato | Evidencia concreta |
| --- | ---: | --- |
| Modelado funcional | 0.6 | Dos módulos, ciclos de negocio/proyecto, responsables, ODS, dimensiones y recursos digitales descritos en ARQUITECTURA.md; interfaz y capturas 01, 03, 04 |
| Diseño de requisitos | 0.6 | Historias GN-01–GN-14 con aceptación verificable, restricciones, perfiles y reglas; pruebas con los mismos identificadores |
| Arquitectura y diseño técnico | 0.5 | Presentación en módulos JS, API HTTP, servicios de dominio, persistencia SQLite, autenticación y permisos existentes; archivos y rutas documentados |
| Diseño de datos e integridad | 0.4 | Entidades y relaciones, FK compuestas, unicidad, capacidad transaccional, fechas, monedas, versionado y reintentos; pruebas GN-03, GN-07–GN-10, GN-13–GN-14 |
| Calidad técnica | 0.4 | Validaciones de servidor, CSRF/origen, sesiones, errores, prevención de fórmulas CSV, regresión, concurrencia y pruebas reales de navegador; VERIFICACION.md |
| Total de referencia | **2.5** | La calificación corresponde al docente; la tabla identifica evidencias de cumplimiento |

## Límites del incremento

Los recursos digitales se registran administrativamente; no se compran ni activan licencias del proveedor. No hay integración con sistemas de licenciamiento externos. Los costos de contratos y presupuestos se consultan en este módulo y su reporte; no se convierten automáticamente en gastos del módulo Finanzas. Las mediciones se registran manualmente con una fuente textual o enlace; no se infieren automáticamente desde el inventario ni se adjuntan archivos. Las monedas/unidades diferentes se mantienen separadas. La aplicación usa un espacio compartido, sin separación por organizaciones. La evidencia incluye un video nuevo del flujo completo, capturas y una guía de demostración reproducible.
