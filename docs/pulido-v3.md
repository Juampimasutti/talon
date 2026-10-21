# Pulido de uso y pendientes v3

ARCA queda para el final. El punto 4 del archivo recibido se excluye por indicación del usuario: no se agregan alias de API ni se cambian los 404/403 de esas rutas.

## Uso diario

El tablero incorpora accesos a cobrar/pagar y registrar movimientos según los permisos y módulos activos. Los indicadores llevan a su sección correspondiente; no se agregan métricas ficticias ni nuevos circuitos contables. Se corrigió además el estado de error del tablero, que quedaba tapado por la pantalla de carga.

El editor reúne impuestos y notas en «Más opciones», conservando valores y cálculo aunque se cierre. El resumen indica si tiene datos. Los errores abren la sección antes de enfocar el campo. La identificación de la factura de compra permanece visible. El encabezado muestra el total real y permite saltar a su detalle, también en celular.

El alta anuncia que se cambia de empresa, confirma su nombre y abre el tablero con la sesión y la caché renovadas. Una lista de módulos vacía se rechaza. Los CUIT se comparan sin guiones y las altas concurrentes se serializan en PostgreSQL. La migración no elimina empresas históricas duplicadas: conserva sus identidades para recuperación y bloquea nuevas duplicaciones. Si no existen duplicados previos, también crea un índice único. Los duplicados históricos requieren revisión antes de unificarse; no se fusionan automáticamente.

La protección de secciones ya existía. Ahora muestra «Sin permiso» o «Módulo no activo» con regreso al tablero, sin redirección automática que oculte el motivo. El menú sigue filtrado por permisos y módulos. Un 200 del contenedor de Next no significa que se muestre la sección ni que la API autorice datos.

## Retención de respaldos

Se conservan las últimas 14 copias automáticas de cada empresa, tanto en la base como en `backups/<base>/`. El evento de auditoría permanece; sólo vence su contenido. No se purgan copias manuales ni previas a vaciar, eliminar o recuperar. La retención se aplica al ejecutar el trabajador, después de exportar las copias nuevas. El directorio de respaldos no debe contener archivos ajenos con nombres de Talón. Guardá copias también en otro dispositivo.

### Ejecutar con Talón cerrado en Windows

PostgreSQL debe estar encendido (Docker Desktop y su contenedor, si corresponde). Una tarea no puede respaldar una base apagada. Primero probá `scripts/respaldar-windows.cmd` con doble clic desde la instalación habitual que contiene `.env.local`. Un error se informa con código de salida distinto de cero.

1. Abrí **Programador de tareas** → **Crear tarea básica**.
2. Nombre: «Talón - respaldo diario». Elegí horario diario y una hora en que la PC esté encendida.
3. Acción: iniciar un programa. Programa: `C:\Windows\System32\cmd.exe`.
4. Argumentos: `/c ""C:\RUTA\A\talon\scripts\respaldar-windows.cmd""`, reemplazando la ruta por tu instalación.
5. En las propiedades, elegí ejecutar con tu usuario habitual y ejecutar lo antes posible si se omitió el horario. No hace falta administrador ni guardar credenciales de PostgreSQL en la tarea.
6. Ejecutá la tarea manualmente y verificá resultado `0x0` y una copia en `backups`. No abras otra instalación con otra configuración.

El comando es idempotente por empresa, día y versión. Si coincide con el servidor, un candado evita que dos trabajadores se solapen. No instala tareas ni cambia Windows por su cuenta.

## Verificación de esta entrega

- Build de producción y TypeScript correctos.
- Suite completa: 112 pruebas aprobadas, ninguna omitida. Luego se añadió una prueba específica de migración con CUIT históricos duplicados; el circuito de integración se volvió a ejecutar con esa cobertura adicional.
- PostgreSQL aislado: altas simultáneas (200 y 409), rechazo de módulos vacíos, retención real de 21 copias automáticas a 14 conservando archivos, copias manuales y eventos de auditoría.
- Navegador sobre producción y base de demostración real, sin API simulada: alta y cambio de empresa, tablero, venta con Ctrl+Enter y recarga, conservación de notas al cerrar opciones, apertura y foco ante impuesto inválido, cinco rutas de Mateo protegidas y menú filtrado.
- Tablero y formularios de venta/compra a 1440, 390 y 320 px sin desbordamiento horizontal de la página. Sin errores de JavaScript ni respuestas 500 en ese recorrido. Las tablas conservan su desplazamiento interno.
- Lint: cero errores; las cuatro advertencias anteriores (navegación de sesión y virtualización) permanecen.
- Se eliminó únicamente la empresa ficticia creada para la prueba de navegador mediante el circuito oficial con respaldo. No se usó una base real ni se desplegó.

Capturas del sistema ejecutándose: [tablero](capturas/tablero-pulido-v3.png) y [venta en celular](capturas/venta-pulida-390.png).

Pendientes reales: ejecutar y comprobar la tarea programada en la PC Windows del usuario, revisar manualmente duplicados históricos si existen, continuar el pulido de los demás módulos durante un piloto y, al final, abordar ARCA/CAE/QR. El comando de Windows se entrega preparado, pero este entorno Linux no verifica el Programador de tareas de esa PC. Los límites de recuperación y rubros descritos en las guías anteriores siguen aplicándose.

## Actualización en tu PC

Descargá el código actualizado y seguí la [guía de actualización existente](mejoras-uso-y-seguridad.md#actualizar-una-instalación-existente). Conservá `.env.local`, `backups` y los datos de PostgreSQL. `npm run local` aplica la migración nueva. Actualizar el repositorio en la nube no cambia automáticamente la instalación que ya tenés abierta en tu computadora.

Archivos principales modificados:

- `src/components/documentos/editor-screen.tsx`: opciones secundarias y acceso al total.
- `src/components/tablero/tablero-screen.tsx`: accesos, indicadores navegables y estado de error.
- `src/components/shell/panel-shell.tsx` y `src/lib/auth/access.test.ts`: explicación de acceso denegado y regresiones de permisos.
- `src/lib/company-setup.ts`, `src/lib/guards.ts`, `drizzle/0028_company_validation.sql` y `company-create-form.tsx`: validaciones, protección de CUIT y transición a la empresa nueva.
- `scripts/backup-worker.mjs`, `scripts/respaldar-windows.cmd` y `backup-screen.tsx`: retención y ejecución independiente del servidor.
- `src/lib/db/business-flows.integration.test.ts`: pruebas de concurrencia, migración histórica y retención.
