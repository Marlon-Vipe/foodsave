# Verificación · Gestión Logística

Validación local: **61 pruebas automatizadas aprobadas** (8 nuevas de Logística y 53 de regresión de FoodSave) y flujo de Logística aprobado en Chromium.

| Casos nuevos | Resultado |
|---|---|
| GL-01/02: alta, reposición, salida, saldo compartido e historial | Aprobado |
| GL-03: cantidades, vencimiento, límite, salida total y dos salidas simultáneas | Aprobado |
| GL-04/05: filtros, fecha de Santo Domingo, paginación, ambos CSV y auditoría | Aprobado |
| GL-06: perfiles, sesión, origen y CSRF | Aprobado |
| GL-07: cierre operativo, retiro directo y reversión ante error de persistencia | Aprobado |
| GL-08: migración repetible y conservación de datos y permisos | Aprobado |
| Chromium: registro, entrada, salida rechazada y válida, historial, filtros, descargas, roles, y ancho de página a 390, 768 y 1440 px | Aprobado |

```bash
npm test
npm ci
npx playwright install chromium
npm run test:logistics:browser
```

La prueba de navegador usa SQLite en memoria y genera estas capturas con cuentas de prueba:

1. [Registro de lote y existencias iniciales](evidence/01-existencias-iniciales.png)
2. [Rechazo por existencias insuficientes](evidence/02-disponibilidad-validada.png)
3. [Historial con entrada inicial, reposición y salida](evidence/03-historial-completo.png)
4. [Filtro de salidas y exportación](evidence/04-historial-filtrado.png)
5. [Perfil supervisor con acceso de consulta y exportación](evidence/05-supervisor-consulta.png)
