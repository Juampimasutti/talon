# Verificación de uso y seguridad · 21/10/2026

Implementación de los bloques 1 y 2 acordados: formularios más claros, reversiones
coordinadas y respaldos con recuperación. **ARCA se dejó pendiente por indicación del
usuario**; no se cambió su adaptador, no se desplegó ni se usó una base real.

Guía: [mejoras de uso y seguridad](mejoras-uso-y-seguridad.md).

## Validación automatizada

- Build de producción y TypeScript correctos; manifiesto de archivos offline regenerado.
- Suite completa con `RUN_FLOW_TESTS=1 RUN_DB_TESTS=1 npm test`: **111 pruebas aprobadas
  en 26 archivos**, sin omisiones. Incluye seed limpio y aislamiento RLS.
- Los **13 circuitos HTTP con PostgreSQL aislado** se volvieron a ejecutar tras el último
  ajuste del editor y de la validación de rutas: todos aprobados.
- Lint: **0 errores y 4 advertencias preexistentes**: dos sobre navegación de sesión
  con recarga completa y dos sobre TanStack Virtual/React Compiler.
- Arranque y proceso de copias ejecutables con Node, sin requerir un cargador TypeScript en producción. La exportación consulta el contenido sólo de las copias faltantes, en lote.
- `git diff --check`: correcto. Sin cambios de dependencias, `package-lock.json`,
  adaptador ARCA ni `public/sw.js`.

Las pruebas de base crean un PostgreSQL de prueba independiente y lo eliminan al
terminar. No limpian empresas de la demo habitual.

### Casos de seguridad y consistencia comprobados

- Recuperación mediante la API de respaldos de inmobiliaria y constructora, además de
  la comparación de todas sus filas en una restauración técnica con rollback.
- Recuperación de una empresa existente: respaldo automático del estado reemplazado,
  conservación de números ya usados, desactivación de colaboradores y rechazo del
  nombre de confirmación incorrecto.
- Otro usuario no puede descargar ni recuperar el respaldo ajeno.
- Dos ejecuciones del proceso automático producen una sola copia diaria compatible;
  se verifica el archivo JSON guardado, su empresa y sus documentos. No incluye usuarios
  globales, contraseñas ni sesiones.
- Las operaciones offline conservan la generación de recuperación del servidor. Una
  operación antigua sin esa generación entra en conflicto incluso si el reloj del
  dispositivo la fecha en el futuro; no se vuelve a aplicar por error.
- Reversión de cobro de alquiler ya liquidado y pagado: quedan caja y cuentas del
  propietario en cero, se anulan recibo y factura de comisión y se reabre el alquiler.
- Si falta saldo para una reversión, se rechaza la transacción sin anular documentos.
- Reversión de certificados desde el último período: restaura mediciones por ítem,
  recuperación de anticipo, reparo, cobros de cuotas y cuentas. El anticipo revierte
  juntos su factura y su recibo.
- Una vista previa desactualizada no permite confirmar. Dos confirmaciones concurrentes
  producen una sola reversión. Las rutas no admiten nombres de recurso fuera de la lista.
- Dos envíos concurrentes del editor con el mismo identificador guardan un solo
  comprobante y un solo cambio de saldos. Reutilizar el envío con otros datos, o después
  de anular su comprobante, se rechaza.
- Dos compras simultáneas del mismo proveedor y número se rechazan como duplicado,
  incluso si se omitió el punto de venta. El aviso devuelve el enlace al original.

## Navegador de producción local

Chromium, datos ficticios y API real sobre PostgreSQL local; sin respuestas simuladas.

- Crear un proveedor desde la compra conserva artículos y notas y lo deja seleccionado.
- Escribir un nombre no equivale a seleccionar: aviso preciso, campo marcado y foco.
- Selección por flechas/Enter, búsqueda por F2 y emisión por Ctrl+Enter.
- Cantidad cero: se señala el renglón y no se envía una solicitud de emisión.
- Dos Ctrl+Enter seguidos: una sola emisión; compra de $24,20 guardada por el importe
  calculado, con proveedor y número reales de la ficha de prueba.
- Compra duplicada: se muestra el enlace al comprobante registrado, conservando el borrador.
- Crear respaldo y recuperar desde la pantalla: se conserva el comprobante de la copia
  y deja de aparecer el creado después de ella.
- Anulación desde Inmobiliaria de un alquiler cobrado, liquidado y pagado: dos
  comprobantes anulados y caja final cero.
- Pantallas de compras, inmobiliaria y respaldos revisadas a **1440, 390 y 320 px**,
  con los módulos correspondientes activos. Sin desbordamiento de la página,
  errores JavaScript ni respuestas 500.
- Los ocho tenants creados para estos recorridos se eliminaron al terminar mediante
  el circuito oficial, guardando sus respaldos. Las cinco empresas demo permanecen.

### Regresiones del circuito anterior

- Venta de contado por interfaz y atajos: stock 100 → 99, caja +$453,08, persistencia
  tras recarga e impresión A4/PDF no electrónica. No se probó impresora física.
- Laura en empresa comercial: cero solicitudes a `/api/estacion`, sin 403 ni errores
  de consola. El vendedor recibe el 403 esperado al pedir proveedores.
- Aviso sin conexión visible y persistente; vale guardado en IndexedDB sin POST;
  provisorio correcto y recarga F5 offline.
- Reconexión: sincronización automática observada en unos 1.013 ms, cola vacía y una
  sola creación en servidor (vales 7 → 8). Sin errores JavaScript ni transiciones
  falsas a «en línea» en ese recorrido.

## Archivos principales

| Área | Cambios |
| --- | --- |
| Formularios | Editor de comprobantes, alta de ficha en diálogo, cliente API con identificador de envío, selección de empresa contenida en el menú |
| Historial | Auditoría por ficha/comprobante, campos modificados con valores anteriores y posteriores |
| Reversiones | Servidor `reversals.ts`, panel compartido, integración en Inmobiliaria y Constructora, movimientos vinculados a la operación |
| Respaldos | Gestión de empresas, pantalla de recuperación, proceso local de copias y arranque junto al servidor |
| Persistencia | Migraciones `0021` a `0027`, esquema, bloqueo por empresa y pruebas de circuitos |
| Offline | Generación de recuperación en referencia/cola, comprobación al sincronizar y renovación de referencia al abrir |
| Documentación | Guía de actualización, este informe, actualización de guía de rubros y capturas |

## Límites reales

- ARCA/CAE/QR quedan para el final, sin verificar ni habilitar emisión electrónica real.
- Las reversiones coordinadas de esta entrega cubren alquileres y las operaciones de
  obra enumeradas en la guía. Ventas inmobiliarias con señas/depósitos, subcontratos y
  facturación de unidades conservan los pendientes anteriores.
- Las operaciones de obra anteriores al criterio fiscal confirmado requieren revisión
  técnica; no se recalcula su historial ni se fabrican facturas retroactivas.
- La recuperación guiada usa respaldos almacenados por el sistema de la misma versión.
  Importar archivos externos, recuperar identidades globales perdidas o migrar una copia
  de otra versión sigue requiriendo intervención técnica.
- Las copias locales requieren PostgreSQL local y el servidor encendido. No se instaló
  una tarea para cuando el programa esté cerrado, ni un servicio externo. No se eliminan
  archivos automáticamente: revisar espacio y conservar una copia fuera de la PC.
- Las pantallas nuevas siguen requiriendo conexión. No se amplió el alcance offline a
  inmobiliaria o constructora. No se abordó la paginación integral ni Contabilidad.
- Falta el piloto de uso diario con un negocio y la revisión contable/fiscal de casos
  reales. Estas pruebas no son una certificación de producción.

## Capturas de los recorridos

- [Compra con proveedor seleccionado y alta sin salir](capturas/compra-asistida.png)
- [Confirmación de recuperación](capturas/recuperar-empresa.png)
- [Vista previa de anulación de alquiler](capturas/reversion-alquiler.png)
