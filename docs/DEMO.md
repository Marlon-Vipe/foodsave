# Guion de demostración · FoodSave · Épica 1

Compromiso solicitado: **29 de octubre de 2026 a las 20:00, America/Santo_Domingo**.

## Preparación

1. Usa Node.js 24 o posterior. Ejecuta `npm run demo` y `npm start` en la raíz del repositorio.
2. Abre http://localhost:3000. Las cuatro cuentas y sus contraseñas aleatorias están en el archivo local `.demo-credentials.json` (no se publica en Git).
3. Ten abierta una segunda ventana privada para probar otro perfil simultáneamente.
4. Ejecuta `npm test` para mostrar el resultado reproducible de las 27 pruebas.

## Exposición sugerida: 6–8 minutos

1. **Registro:** pulsa Crear cuenta y registra un correo nuevo, nombre y contraseña de al menos 12 caracteres. Inicia sesión. El perfil asignado es lector; no se puede elegir administrador desde el registro.
2. **Restricciones:** abre Inventario. El lector consulta y filtra alimentos, pero no ve el formulario para crear ni los controles de consumo/descarte. No aparecen Usuarios, Roles ni Actividades.
3. **Cierre de sesión:** cierra la sesión. Refresca la página y verifica que vuelve al login.
4. **Administración:** entra con el administrador y busca al usuario recién creado. Cambia su perfil a editor y guarda. En la otra ventana, comprueba que una sesión anterior del usuario queda invalidada; inicia sesión otra vez para recibir el nuevo acceso.
5. **Acceso autorizado:** con el editor, registra un alimento con nombre, categoría, fecha y cantidad. Márcalo como consumido. El editor no puede administrar usuarios.
6. **Permisos:** como administrador, abre Roles y permisos. Habilita Ver reportes para el editor y guarda. Su sesión se revoca; tras volver a entrar, aparece Reportes. Restaura el permiso al finalizar si quieres conservar la matriz inicial.
7. **Estado de cuenta:** desactiva el usuario. La sesión existente deja de funcionar y el login es rechazado. Activa nuevamente la cuenta para continuar.
8. **Acceso no autorizado por API:** como lector, abre la consola del navegador y ejecuta `fetch('/api/users').then(async r => console.log(r.status, await r.json()))`. Debe devolver **403**. Después de cerrar sesión, la misma solicitud devuelve **401**. Esta es una validación del servidor, independiente del menú.
9. **Trazabilidad:** entra como administrador y abre Actividades. Muestra el registro, los accesos, las modificaciones, el alimento procesado y el acceso denegado, con actor y fecha/hora de Santo Domingo.
10. **Pruebas y código:** muestra `npm test`, las capturas y el video guardados, y el commit de la entrega en GitHub. Si Actions no pudo ejecutarse, distingue ese estado de las pruebas locales aprobadas.

## Evidencias incluidas

Las capturas y el video están en `docs/evidence/`. El video automatizado muestra los flujos principales; este guion cubre además una demostración manual con dos sesiones simultáneas.

La recuperación de contraseña por correo y las notificaciones no están implementadas en esta épica. El inventario es compartido por todas las cuentas de esta instalación.
