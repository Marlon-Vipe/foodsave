# Verificación · Gestión Logística

Validación local: **66 pruebas automatizadas aprobadas** (13 de Logística y 53 de regresión de FoodSave) y flujo de Logística aprobado en Chromium.

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
npm run test:logistics:dashboard
```

La prueba de navegador usa SQLite en memoria y genera estas capturas con cuentas de prueba:

1. [Registro de lote y existencias iniciales](evidence/01-existencias-iniciales.png)
2. [Rechazo por existencias insuficientes](evidence/02-disponibilidad-validada.png)
3. [Historial con entrada inicial, reposición y salida](evidence/03-historial-completo.png)
4. [Filtro de salidas y exportación](evidence/04-historial-filtrado.png)
5. [Perfil supervisor con acceso de consulta y exportación](evidence/05-supervisor-consulta.png)


## Verificación del panel

- GL-09 comprueba la agrupación por alimento y categoría, FEFO, el límite de siete días, vencidos y el cálculo diario con cambio de fecha de Santo Domingo.
- GL-10 comprueba mínimos, desactivación con cero, productos agotados, persistencia, versiones, concurrencia, permisos y reversión ante error de auditoría.
- GL-11 se comprueba en Chromium con salida desde FEFO, entrada desde alerta, actualización del saldo, descarte preparado y confirmado, y lote de reposición para un alimento agotado.
- La prueba de navegador verifica el perfil supervisor y ausencia de desbordes de página a 390, 768 y 1440 píxeles.

[Panel logístico](evidence/06-panel-logistico.png) · [Mínimos y alertas](evidence/07-minimos-y-alertas.png) · [Descarte preparado](evidence/08-descarte-preparado.png) · [Consulta del supervisor](evidence/09-supervisor-panel.png)

[Video del flujo original de Logística](evidence/FoodSave-Video-Gestion-Logistica.mp4) · [Capítulos del video](evidence/CAPITULOS-VIDEO.txt).

## Navegación adaptable

`npm run test:responsive` verifica Usuarios, Roles y permisos, Actividades, Inventario, Reportes, Operaciones y Logística en 320×568, 390×844, 700×600, 701×600, 768×800, 844×390, 1024×768 y 1440×900.

El botón de cierre de sesión se mantiene dentro de la pantalla y se puede pulsar tanto al inicio como al final de cada página. La prueba también verifica el menú móvil, su cierre con Escape, el cierre de sesión y ausencia de desbordes horizontales de página.

[Vista móvil al final de la página](evidence/responsive-390-logout.png) · [Vista de escritorio al final de la página](evidence/responsive-1440-logout.png)
