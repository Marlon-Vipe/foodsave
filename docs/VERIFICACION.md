# Verificación de entrega · FoodSave · Épica 1

Fecha de validación: 28 de octubre de 2026, America/Santo_Domingo.

## Resultado local

- Entorno: Node.js 26.9.0, SQLite 3.53.4, Chromium mediante Playwright 1.62.1.
- Suite HTTP: **27 casos, 27 aprobados, 0 fallos**. Ejecución registrada en `test-results.txt`.
- Demostración automatizada: aprobada. Comprueba registro, login/logout, administración, cambios de rol y permisos desde la interfaz, alimentos, reportes y rechazo 403 a un lector. Informe en `docs/evidence/browser-results.json`.
- No hubo errores JavaScript durante la demostración. El login no presentó desbordamiento horizontal en los tres anchos comprobados (390, 768 y 1440 px).
- Ocho capturas verificadas y video MP4 de 30.7 segundos. Se ajustó la velocidad de reproducción de la captura automatizada para facilitar su lectura. El video no tiene audio. La decodificación completa con FFmpeg terminó sin errores.
- Base de datos, credenciales aleatorias de demostración y archivos de sesión excluidos de Git y del ZIP.

## Resultado remoto

Código validado: commit `d9650b4a0e9d8252a1c22837274b6b0c9a032b26` en `main` del repositorio privado [Marlon-Vipe/foodsave](https://github.com/Marlon-Vipe/foodsave).

[GitHub Actions · ejecución 40808536612](https://github.com/Marlon-Vipe/foodsave/actions/runs/40808536612) terminó con estado failure **sin iniciar ningún paso del job**. La anotación de GitHub informa de pagos recientes fallidos o necesidad de aumentar el límite de gasto de la cuenta. No es un resultado de ejecución de las pruebas del código; las pruebas remotas permanecen sin verificar.

Se conservó el workflow reproducible. Una vez resuelto el estado de facturación de la cuenta, el propietario puede volver a ejecutar ese workflow. No se modificaron ajustes de facturación.

Los commits posteriores de documentación no alteran el código validado. La entrega proporciona entorno local e instrucciones reproducibles; no se desplegó un servicio público.

## Corrección del bloqueo de demostración

Se separaron los contadores de registro y login. Los inicios de sesión correctos dejan de consumir el presupuesto de fallos y no borran los fallos anteriores. Tres pruebas de regresión verifican veinte accesos correctos consecutivos, el bloqueo tras ocho fallos y la independencia del registro. Se retiraron los contadores del entorno local afectado y se comprobó el acceso real de administrador con respuesta 200, seguido del cierre de sesión.
