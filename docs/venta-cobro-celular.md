# Venta y cobro desde el celular

## Cambios

En pantallas menores a 768 px, los renglones de venta, compra, pedido y remito se presentan como fichas compactas: código, descripción, cantidad, precio, descuento y total, sin tener que desplazar la tabla hacia los costados. En escritorio se conserva la tabla. Se usa una sola instancia de cada campo: cambiar el ancho no duplica controles ni pierde los valores del borrador.

El buscador está antes de los renglones y tiene botón **Buscar** en celular, además de Enter. Los campos numéricos solicitan teclado decimal. F2 y Ctrl+Enter siguen disponibles. Cantidades, precios, IVA, descuentos, permisos, API y cálculo de totales se conservan.

En **Cuentas corrientes**:

- Buscá una cuenta por nombre. Se muestran hasta 40 coincidencias con saldo; si hay más, se indica que afines la búsqueda. No se ocultan coincidencias detrás del corte anterior sin explicación.
- Al elegirla desde el celular, se muestra su nombre y saldo junto al formulario. **Cambiar cuenta** vuelve al listado. En escritorio se ven las dos columnas.
- **Usar saldo completo** copia el importe positivo pendiente. También podés ingresar un cobro o pago parcial. No se aplican cargos nuevos ni se cambia el tratamiento de anticipos.
- Mientras se registra, se bloquean los envíos repetidos y la edición del formulario. Los errores quedan visibles y conservan el importe.
- Después de cobrar, el saldo y los movimientos se actualizan. **Ver recibo e imprimir** lleva al comprobante si el puesto tiene acceso a Ventas. Los pagos a proveedores conservan su circuito existente, sin inventarles una factura.
- Los movimientos quedan después del formulario, en una sección desplegable. Clientes y proveedores se muestran según los permisos de consulta del puesto.

Se corrigió la invalidación de caché del mayor: faltaban la empresa y el tipo de cuenta en su clave. Se actualizan también caja, tablero y listado de comprobantes después de registrar.

## Comprobaciones realizadas

Build de producción y TypeScript correctos. Suite completa: **113 pruebas aprobadas, ninguna omitida**, incluyendo PostgreSQL, permisos y operaciones contables existentes. Lint sin errores y con las mismas cuatro advertencias previas de navegación de sesión y virtualización.

Prueba de navegador contra producción y PostgreSQL de demostración, sin API simulada:

1. Buscar y elegir entre dos artículos, cargar cantidad **2,5** y descuento **10%**, agregar y quitar otro artículo.
2. Cambiar entre 1440, 768, 390 y 320 px sin perder el borrador ni desbordar la página. En celular tampoco se desborda la tabla de renglones.
3. Emitir una venta por **$272,25**. Verificar persistencia y stock de **10 a 7,5**.
4. Registrar un cobro parcial de **$100**, disparando dos envíos consecutivos del formulario: un solo POST y un solo recibo. Caja **+$100**, saldo pendiente **$172,25** y dos movimientos en la cuenta.
5. Abrir el recibo, recargarlo y comprobar su importe. Usar saldo completo para cancelar exactamente los **$172,25** restantes.
6. Pagar **$80** a un proveedor: caja **−$80** y deuda de **$1.210 a $1.130**, conservando los signos.

Además se comprobaron F2, Enter y Ctrl+Enter con validación de venta incompleta en escritorio. Mateo ve sólo la pestaña de clientes, sin botón de cobro ni solicitudes de proveedores, y la búsqueda sin coincidencias muestra su estado vacío.

Sin errores de JavaScript ni respuestas 500 en el recorrido. La empresa ficticia de la prueba se elimina mediante el circuito oficial con respaldo al finalizar.

Capturas: [venta en celular](capturas/venta-mobile-390.png), [320 px](capturas/venta-mobile-320.png), [escritorio](capturas/venta-mobile-1440.png) y [cobro en celular](capturas/cobro-mobile-390.png).

Archivos principales: `src/components/documentos/editor-screen.tsx` y `src/components/cuentas/cuentas-screen.tsx`. No se cambian dependencias, esquema ni lógica del servidor.

## Piloto de uso diario

Las comprobaciones anteriores son una simulación técnica con datos de demostración. Falta el piloto con una persona usando Talón en su PC y su teléfono. Para hacerlo sin operaciones fiscales reales, usá una empresa de demostración y recorré:

- Una venta de contado y otra a cuenta, con los artículos que usás habitualmente como referencia.
- Quitar un renglón antes de emitir, cantidades fraccionadas y un descuento.
- Un cobro parcial y la cancelación del saldo restante, revisando el recibo.
- Un pago a proveedor y la consulta de caja.
- Impresión en tu impresora y uso con el teclado del teléfono real.

Anotá pantalla, acción, resultado esperado y resultado observado cuando algo sea confuso. El editor y los cobros continúan requiriendo conexión; los circuitos que ya admitían operaciones offline conservan su implementación.

**ARCA, CAE y QR quedan para el final. El punto 4 del archivo de pendientes v3 sigue excluido.** No se desplegó ni se usó una base real. Los demás pendientes y límites documentados anteriormente siguen vigentes.

## Actualizar en tu PC

Seguí la [guía de actualización](mejoras-uso-y-seguridad.md#actualizar-una-instalación-existente), conservando `.env.local`, respaldos y datos de PostgreSQL. Después ejecutá `npm run local`. El código actualizado en GitHub no reemplaza automáticamente la instalación de tu PC.
