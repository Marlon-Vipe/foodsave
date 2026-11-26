# Video · Gestión de Negocios y Licencias

[Reproducir el video MP4](evidence/FoodSave-Video-Gestion-Negocios-Licencias.mp4) · [Índice de capítulos](evidence/CAPITULOS-VIDEO.txt) · [Verificación técnica](evidence/video-verification.json)

Duración: **6 minutos y 58 segundos** (417.72 segundos).

Grabación real de la aplicación, con rótulos por etapa, pausas para leer y sin audio, en el mismo formato de las demostraciones anteriores. Los capítulos también están incluidos como metadatos del MP4, para los reproductores compatibles.

## Flujo mostrado

1. Inicio de sesión de administración y registro de una iniciativa con presupuesto, responsable y ODS 2/12.
2. Creación y activación de un proyecto; activación y cierre del negocio.
3. Indicadores ambientales, sociales y económicos, con mediciones, evidencia y avance; descarga del reporte de impacto.
4. Registro de software, equipo, área y contrato con costo, vigencia y cupos.
5. Asignación de los tres cupos a un usuario, un equipo y un área; comprobación de disponibilidad agotada.
6. Liberación de una asignación con motivo y recuperación del cupo.
7. Consulta de próximos vencimientos y descarga de reportes de vigencia y de uso.
8. Renovación a 90 días, comprobación del cambio en el filtro de vencimientos e historial.
9. Acceso del supervisor para consulta y reportes, sin controles de creación/asignación; cierre de sesión.

La grabación usa cuentas y datos ficticios en una base en memoria. No modifica la instalación local ni muestra contraseñas reales. No se llama a OpenAI ni a proveedores de licencias. Las cifras de impacto son ejemplos de clase, no resultados reales del producto.

## Reproducir la grabación

Con Node.js 24+ y Playwright/Chromium:

```sh
npm ci
npx playwright install chromium
npm run demo:business:video
```

El script scripts/business-demo-video.mjs graba WebM y guarda el índice de etapas, los tres CSV descargados y la verificación funcional en ../business-video. FOODSAVE_VIDEO_DIR permite elegir otra carpeta de salida. El ritmo predeterminado es el de la demostración pausada; FOODSAVE_VIDEO_PACE=0.01 sirve exclusivamente para ensayos rápidos del flujo, no para la entrega.

El MP4 entregado usa H.264, píxeles yuv420p, inicio rápido para reproducción y resolución 1440×1000. Se convirtió con FFmpeg, conservando el ritmo original de la grabación. Se verifican la duración, los 28 capítulos y la decodificación completa; el resultado y la suma SHA-256 están en video-verification.json. El ZIP incluye exactamente el mismo MP4 que se entrega por separado.
