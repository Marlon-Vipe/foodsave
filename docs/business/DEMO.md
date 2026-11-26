# Guía para exponer Gestión de Negocios en clase

Duración sugerida: 8–12 minutos, dejando tiempo para leer cada pantalla. Todos los valores siguientes son **datos ficticios de demostración**, no resultados reales de FoodSave.

## Preparar

1. Ejecutar los comandos de ENTREGA.md; entrar como administrador con las credenciales que imprimió npm run demo. En el equipo del desarrollo se usa http://localhost:3002. Si la sesión anterior venció al actualizar los permisos, iniciar sesión nuevamente.
2. Mantener abierta la carpeta docs/business/evidence y esta guía. No proyectar .env ni archivos de credenciales. Las pruebas automatizadas no requieren conectarse a OpenAI.
3. Explicar el alcance en una frase: “FoodSave organiza iniciativas sostenibles y los recursos digitales que las apoyan; mide resultados con evidencia y controla licencias por vigencia y capacidad”.

## Parte 1 · Negocios y ODS (3–4 minutos)

1. Abrir **Negocios e impacto → + Registrar negocio**. Nombre: Comedor circular DEMO; tipo Iniciativa; responsable Editor; presupuesto 2500 DOP; descripción “Recuperar alimentos y mejorar el acceso a comidas del comedor”. Marcar ODS 2 y 12. Crear negocio.
2. Mostrar que nació en Borrador. Abrir **+ Crear proyecto**: Plan semanal de rescate; responsable Editor; inicio hoy; fin dentro de siete días.
3. En **Editar datos y ciclo de vida**, activar el negocio. Expandir el proyecto, cambiar a Activo y guardar. Explicar que no se puede iniciar proyecto con negocio sin activar ni completar negocio con proyectos pendientes.
4. Definir tres indicadores, asociados al proyecto:

| Nombre | Dimensión | ODS | Unidad | Base | Meta | Medición ficticia |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Alimentos recuperados | Ambiental | 12 | kg | 0 | 100 | 40 |
| Comidas entregadas | Social | 2 | comidas | 0 | 200 | 80 |
| Ahorro registrado | Económico | 12 | DOP | 0 | 5000 | 1800 |

Usar fecha límite dentro de siete días. En cada tarjeta abrir **Registrar medición**, indicar fecha de hoy y evidencia “Demostración sintética; acta DEMO-01 del comedor”. Mostrar avances 40%, 40% y 36%. Aclarar que se registran manualmente y no se suman unidades distintas.

5. Expandir **Todas las mediciones** e **Historial de cambios**. Mostrar actor, fecha y datos anteriores/nuevos. Descargar **Reporte de impacto CSV**. Filtrar por ODS 12 y Activo.
6. Para mostrar cierre, volver a consultar el negocio, completar su proyecto y después el negocio. Se puede archivar y restaurar a Borrador. Las mediciones y el historial permanecen.

## Parte 2 · Software y licencias (4–5 minutos)

1. Abrir **Software y licencias → + Registrar software**: FoodSave Analítica DEMO, proveedor Proveedor de demostración. Guardar.
2. **+ Registrar equipo o área**: equipo Equipo comedor 01. Repetir para el área Área de logística.
3. **+ Registrar licencia**: seleccionar software; referencia DEMO-LICENCIA-001; asociar al negocio; 3 cupos; inicio hoy; vencimiento dentro de siete días; costo 1800 DOP. Guardar.
4. Explicar tarjetas: estado Vigente, aviso Renovar pronto, 0/3 ocupados y 3 disponibles.
5. En **+ Asignar licencia**, asignar un cupo al Editor. Repetir para Equipo comedor 01 y Área de logística. Mostrar 3/3 ocupados y cero disponibles; la acción de nueva asignación desaparece. La API también rechaza sobreasignaciones con 409, ver pruebas GN-07/GN-08.
6. Mostrar quién asignó cada cupo y cuándo. En la fila del Editor, **Liberar cupos**, motivo “Fin de participación de la persona de demostración”. El disponible vuelve a uno; la fila liberada conserva el motivo y la fecha.
7. Filtrar Estado Próxima a vencer, Próximos días 30; mostrar el contrato. Descargar **Reporte de vencimientos CSV** y **Reporte de uso CSV**. Abrir el CSV en una hoja de cálculo si se necesita mostrarlo.
8. Consultar el contrato y abrir **Renovar o editar licencia**; extender vencimiento a 90 días desde hoy. Guardar. La licencia ya no aparece al filtrar próximas a vencer en 30 días. Limpiar Estado para verla de nuevo. Mostrar el Historial de cambios y la ocupación conservada.
9. Opcional: deshabilitar el contrato; disponible pasa a cero, pero las asignaciones se conservan para su liberación. No se activan servicios reales del proveedor.

## Parte 3 · Acceso y arquitectura (1–2 minutos)

Cerrar sesión desde el botón siempre accesible. Entrar como Supervisor: puede consultar y descargar CSV, pero no crear ni asignar. Entrar como Editor: puede gestionar, sin reportes. El Lector no ve los dos módulos. La comprobación también se realiza en servidor, no solo ocultando botones.

Para explicar arquitectura: “El navegador usa módulos JavaScript y consulta nuestra API HTTP de Node.js en el mismo origen. El servidor valida sesión, permisos y reglas; guarda en SQLite dentro de transacciones, junto al historial. El módulo de negocios y licencias no necesita APIs externas”. Mostrar ARQUITECTURA.md si preguntan por entidades o conexiones.

## Si ocurre un error durante la exposición

- Conflicto de versión: volver a abrir el registro y reintentar con los datos actuales; evita sobrescribir cambios de otra persona.
- Sin cupos: liberar una asignación o ampliar cupos antes de asignar.
- Sin permisos: entrar con el perfil adecuado o revisar sus permisos como administrador.
- Origen/CSRF inválido: abrir exactamente APP_ORIGIN, recargar y volver a entrar.
- ODS sin selección, fechas invertidas o evidencia vacía: corregir el campo; el error aparece en el formulario sin perder lo escrito.
- Software o referencia ya existen: consultarlos y usarlos; para una segunda demostración utilizar otro sufijo DEMO-002.


## Video para acompañar la exposición

[Reproducir el video pausado de Negocios y Licencias](evidence/FoodSave-Video-Gestion-Negocios-Licencias.mp4). Incluye rótulos y 28 etapas para seguir con calma. Consulta [los capítulos](evidence/CAPITULOS-VIDEO.txt) para ir directamente a una función. La grabación es sin audio y usa datos ficticios.
