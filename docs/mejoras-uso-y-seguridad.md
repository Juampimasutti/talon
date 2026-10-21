# Uso diario, correcciones y respaldos · 21/10/2026

Actualización de los bloques de facilidad de uso y seguridad operativa acordados.
**ARCA queda expresamente pendiente para el final**: no se modificó el adaptador fiscal
ni se utilizaron credenciales o una base real.

## Compras y ventas

- El campo Cliente/Proveedor distingue un nombre escrito de una ficha seleccionada.
  Buscar por nombre, CUIT o código; seleccionar con clic o flechas y Enter.
- Si falta seleccionar la ficha, el mensaje dice qué falta, marca el campo y lleva
  el cursor allí. Cantidad, precio, descuento y datos numéricos inválidos se señalan
  antes de enviar. El servidor conserva todas sus validaciones.
- «Crear cliente/proveedor sin salir» guarda la ficha y la selecciona, conservando
  artículos, cantidades y notas del comprobante. Requiere el permiso de alta de la ficha.
- F2 busca artículos y Ctrl+Enter emite. Los atajos del comprobante no se ejecutan
  sobre un diálogo abierto. «Emitir» espera la carga inicial y muestra el estado de guardado.
- El editor identifica cada envío. Dos clics simultáneos o un reintento con el mismo
  contenido reciben el mismo comprobante; no repiten stock, caja ni cuenta corriente.
  Si no se recibió respuesta, reintentar sin cambiar los datos. Una recarga inicia
  un formulario nuevo: ante una duda, consultar los comprobantes antes de cargarlo otra vez.
- Una factura de proveedor con el mismo proveedor, punto y número se rechaza, también
  ante solicitudes concurrentes. El aviso enlaza la factura existente en otra pestaña
  para conservar el formulario actual.
- «Ver historial» abre la auditoría de una ficha o comprobante. Las ediciones de fichas
  nuevas registran campos anteriores y posteriores; no se inventan cambios históricos.

## Reversiones de inmobiliaria y constructora

En cada módulo, abrir **Corregir / anular operaciones**. Elegir una operación, revisar
la vista previa, escribir un motivo y confirmar con **ANULAR**. Se requiere permiso de
anulación del módulo, Ventas, Caja y Cuentas corrientes, más lectura y edición correspondientes.

Se conservan los comprobantes originales con estado anulado y se agregan movimientos
compensatorios. Las filas operativas se retiran del cálculo vigente, pero su contenido
completo queda en un historial de reversiones con usuario, fecha y motivo. Se puede
volver a registrar una operación corregida con nuevos identificadores y números.

| Operación | Efecto coordinado |
| --- | --- |
| Cobro de alquiler | Revierte su liquidación al propietario si existe, comisión, pago y recibo; vuelve a abrir el saldo del alquiler |
| Liquidación al propietario | Revierte la comisión y, si estaba pagada, el pago y su cuenta corriente; conserva el recibo del inquilino para liquidarlo nuevamente |
| Anticipo de obra | Anula juntos factura y recibo; sólo cuando ya no hay certificados que lo recuperen |
| Certificado de obra | Anula factura y cobros asociados; recupera mediciones previas y libera la recuperación de anticipo y el reparo de ese período |
| Cobro de certificado | Anula su recibo y vuelve a abrir ese saldo |
| Cobro de cuota de unidad | Anula recibo y disminuye lo cobrado en la cuota, conservando el importe contractual y sus ajustes |
| Liberación de reparo | Vuelve a retener el fondo, sin facturar ni generar IVA |

Los certificados se revierten desde el último período. Antes de revertir un certificado
con reparo liberado, revertir esa liberación. Si ya se cobró parte del reparo, corregir
primero esos cobros. No se reinterpretan operaciones de QA del criterio fiscal anterior.

La vista previa no guarda cambios. Si la operación cambia antes de confirmar, se exige
revisarla nuevamente. Las confirmaciones concurrentes no duplican compensaciones.
Si la reversión deja una caja negativa y la empresa lo prohíbe, se cancela toda la
transacción. Si hay comprobantes derivados o una autorización fiscal, se bloquea la
corrección y se informa el motivo.

**La anulación no mueve dinero físicamente.** Si se revierte un pago al propietario o
un recibo, también debe haberse efectuado la devolución/acuerdo correspondiente.

## Respaldos y recuperación

Abrir **Configuración → Empresa → Respaldos y recuperación de empresas**.

- **Guardar respaldo ahora:** disponible al administrador de la empresa seleccionada.
- **Descargar JSON:** copia completa con configuración, maestros, movimientos, adjuntos
  inmobiliarios, permisos y referencias a usuarios. No contiene contraseñas ni sesiones.
- **Recuperar:** disponible para respaldos guardados por el sistema de la misma versión.
  Muestra empresa y fecha, exige escribir su nombre exacto y guarda primero otra copia
  del estado actual. Puede recuperar una empresa eliminada por ese usuario.
- La recuperación conserva el techo de numeración conocido y no reactiva otros
  colaboradores. El administrador debe revisar sus permisos antes de habilitarlos.
- Sincronizar primero todos los dispositivos. El actual comprueba su cola antes de
  recuperar; operaciones preparadas antes de una recuperación pasan a revisión si
  llegan después al servidor, para evitar reproducirlas sobre el estado recuperado.
- Las copias de otra versión se pueden descargar, pero requieren recuperación técnica.
  La pantalla no acepta archivos JSON modificados ni importa archivos externos.

### Copias automáticas en la PC

Los comandos habituales `npm run local`, `npm run dev`, `npm start`, `npm run local:prod`
y `npm run demo` inician el proceso de copias junto al servidor. Se crea una copia por
empresa cada 24 horas mientras el programa está abierto y otra compatible después
de actualizar el esquema. También se exportan los respaldos manuales y previos al borrado.
El proceso revisa las copias cada minuto y se cierra con el servidor.

Se guardan en `backups/<nombre-de-base>/talon-<identificador>.json`. La carpeta está
excluida de Git y del ZIP de código. Se puede elegir otra ubicación con `TALON_BACKUP_DIR`
en la configuración local; por ejemplo, un disco dedicado a respaldos. No se borran
copias automáticamente en esta entrega: revisar espacio disponible.

Los archivos contienen datos privados. Guardar además una copia en un medio externo;
una copia en el mismo disco no cubre la pérdida de la PC. Si Talón está cerrado no se
crean nuevas copias. Ejecutar Next directamente, sin estos comandos, tampoco inicia
el proceso. No se instaló una tarea del sistema operativo ni se configuró una nube.

Para una copia inmediata desde la consola: `npm run respaldos:ahora`.
El proceso automático sólo admite PostgreSQL local. Para un servidor remoto hay que
preparar su política de respaldo por separado antes de utilizarlo con datos reales.

## Actualizar una instalación existente

1. Guardar una copia de seguridad de la base y cerrar Talón y su consola.
2. Conservar la carpeta anterior. Copiar el código actualizado a la carpeta habitual,
   sin reemplazar `.env.local`, la carpeta `backups` ni los datos de PostgreSQL/Docker.
3. En esa carpeta ejecutar `npm run local`. Aplica las migraciones pendientes y abre
   el servidor en el puerto 4317. La preparación conserva los datos existentes.
   Para la demo fija usar `npm run demo`, puerto 4319.
4. Recargar el navegador. Comprobar la empresa elegida, el último respaldo y un circuito
   de prueba antes de continuar con operaciones habituales.

No usar comandos para borrar volúmenes o reiniciar la base. Descargar el ZIP no cambia
por sí solo la instalación de la PC. Esta actualización no habilita ni prueba ARCA.

## Comprobaciones y límites

Los resultados de build, pruebas, navegador y offline se registran al finalizar en
[verificación de esta actualización](verificacion-uso-y-seguridad.md).

Quedan fuera de esta entrega: integración ARCA/CAE/QR, reversión de ventas de inmuebles
con señas/depósitos, circuito fiscal completo de subcontratos y unidades, recuperación
de un servidor perdido desde archivos externos, programación de copias con Talón cerrado,
paginación integral y la evaluación del piloto con un negocio real.
