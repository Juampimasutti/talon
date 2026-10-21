# Empresas, inmobiliaria y constructora — 21/10/2026

Implementación a partir de `talon_cambios_pendientes.md` y de las reglas de
certificación indicadas por el usuario. Inmobiliaria se priorizó antes de constructora.
No se usaron bases reales ni se desplegó en internet.

## Cómo probar la entrega

Con el entorno local de demostración configurado:

```sh
npm run demo
```

Conserva la base `talon_demo_fija`, aplica las migraciones nuevas y agrega las
empresas **Inmobiliaria Demo** y **Constructora Demo**, sin restablecer operaciones
anteriores. Laura (`laura@talon.demo`, clave `talon1234`) tiene autorización de estudio
únicamente en la demo preparada por este comando. Elegir la empresa desde el menú.
El puerto de esta demo sigue siendo 4319 en la máquina donde se ejecuta; no es un
sitio publicado ni un enlace público de Codex.

Los índices de las pruebas de CAC están identificados expresamente como ficticios.
No se descargaron ni se inventaron índices oficiales de CAC, ICL o IPC.

## Alta y administración de empresas

En **Configuración → Empresa → Administración de empresas → Nueva empresa**:

- Nombre de fantasía, razón social, CUIT con validación del dígito verificador,
  condición de IVA, IIBB, domicilio, localidad, provincia e inicio de actividades.
- Rubro: comercio, estación, inmobiliaria o constructora. Preselecciona sus módulos;
  se pueden modificar antes de confirmar y desde Configuración posteriormente.
- Uno o varios puntos de venta, separados por comas. Numeradores independientes por
  tipo y punto. La migración conserva los números emitidos y el contador anterior;
  cambiar el punto predeterminado no reutiliza números ya utilizados.
- Crea roles y permisos, caja principal sin saldo ficticio, depósito y lista general,
  ocho tipos de comprobante y, opcionalmente, un plan básico de cuentas.
- Para estación/reparto prepara el catálogo de combustibles, sin inventar precios
  ni existencias. Los equipos y precios se configuran desde sus pantallas.
- El creador queda como administrador y se abre la empresa creada. En **Usuarios**
  puede agregar otro administrador, sumar un usuario existente o dar de alta uno nuevo.
  No se envían invitaciones por correo.

Ser administrador de una empresa **no** concede permiso para crear otras.
Al guardar un puesto editado, queda marcado como personalizado: la preparación de
la demo ya no vuelve a reemplazar sus permisos por los predeterminados. Se reprodujo
y corrigió ese problema del guardado anterior.

La autorización global de estudio/superadmin se guarda separadamente y no se puede
conceder desde la edición de puestos de una empresa. Para autorizar un usuario
existente en una instalación local, usando su conexión administrativa:

```sh
npm run empresa:autorizar -- usuario@dominio estudio
# También acepta superadmin o revocar.
```

El comando rechaza PostgreSQL remoto. Un operador sin empresas activas entra al alta
independiente en `/alta-empresa`. No se habilitó registro público de usuarios.

### Vaciar y eliminar

Ambas acciones requieren administrador de la empresa seleccionada y escribir su
nombre exacto. Antes del borrado se guarda un respaldo JSON completo de los datos
propios de esa empresa. Respaldo y operación son una sola transacción: si falla
cualquier paso, no queda un borrado parcial.

- **Vaciar:** elimina comprobantes, movimientos, existencias, cobros, liquidaciones,
  certificados, cuotas y costos operativos; mantiene maestros, presupuestos,
  contratos de alquiler, configuración y auditoría. Restablece los acumulados de
  certificación del presupuesto y libera las unidades de planes eliminados.
- **Conserva numeradores y claves offline procesadas:** no vuelve a emitir con números
  usados ni vuelve a ejecutar operaciones de sincronización antiguas.
- **Eliminar:** borra la empresa y sus datos. No borra usuarios globales compartidos
  con otras empresas ni el registro del evento y su respaldo.
- La interfaz bloquea estas acciones si este dispositivo tiene operaciones offline
  pendientes o conflictos por resolver en el scope activo. No puede inspeccionar
  las colas locales de otros dispositivos.

El servidor coordina las escrituras por empresa para que el respaldo no quede a mitad
de una operación. Una referencia antigua inconsistente que pudiera provocar un
`CASCADE` hacia otra empresa aborta el borrado completo.

En **Mis respaldos** (`/respaldos`) se puede volver a descargar el archivo, incluso
si la empresa ya no existe. Sólo puede descargarlo el usuario que ejecutó la acción.
Si elimina su última empresa, puede volver a iniciar sesión para consultar sus
respaldos. Incluyen esquema aplicado, configuración, maestros, documentos, movimientos,
roles, permisos y archivos inmobiliarios. Las identidades globales se referencian
por ID/nombre/mail; no se exportan contraseñas ni sesiones de otras empresas.

El respaldo almacenado en PostgreSQL permite recuperar un borrado lógico, pero no
sustituye una copia externa del servidor. **No hay botón de restauración en la app**:
la recuperación requiere intervención técnica. La prueba automatizada restaura los
archivos en la misma instancia de QA con las identidades globales existentes, valida
claves foráneas y compara cada registro; revierte después la transacción de prueba.

## Inmobiliaria

Sólo aparece en el menú y en la matriz de puestos cuando está activada.

- **Propiedades:** dirección, tipo, propietario vinculado a sus fichas de cliente y
  proveedor, disponibilidad y notas. Fotos JPG/PNG/WebP y documentación PDF hasta
  5 MB por archivo; descarga autenticada, sin acceso público al archivo.
- **Contratos:** inquilino, fechas, alquiler inicial, método y período de ajuste,
  depósito pactado, garantes y día de vencimiento. Finalizar conserva las deudas;
  renovar se hace creando el contrato nuevo después de finalizar el anterior.
  No genera un documento legal de contrato ni devuelve el depósito automáticamente.
- **Condiciones configurables:** comisión sobre alquiler cobrado, IVA de la comisión,
  punitorio diario simple y días de gracia. Inicialmente comisión y mora son cero.
  Los cambios afectan cobros/liquidaciones futuros: el cobro conserva la tasa pactada
  y el contrato conserva las referencias del propietario para su historial.
- **Ajustes:** porcentaje fijo, importe manual o coeficiente ICL/IPC con fuente.
  Se controla el intervalo y no se cambian alquileres ya liquidados retroactivamente.
  No consulta automáticamente organismos ni proveedores de índices.
- **Alquileres:** período mensual único, expensas, impuestos y servicios a cargo del
  inquilino. Mora calculada hasta la fecha elegida, sin capitalización y descontando
  los días de gracia. La liquidación crea la deuda; no factura en nombre del propietario.
- **Cobros:** separa lo aplicado a alquiler de lo aplicado a adicionales; admite cobro
  parcial y emite recibo en Ventas, moviendo caja y cuenta corriente una sola vez.
- **Liquidación al propietario:** calcula comisión sobre el alquiler efectivamente
  cobrado, aplica los impuestos que corresponden a la factura y descuenta los gastos
  indicados. Factura la comisión y registra su retención sin un segundo ingreso de
  caja. El pago del neto crea la salida y cancela la deuda al proveedor/propietario.
- **Ventas de propiedades:** reserva, seña con recibo/anticipo del comprador, boleto,
  escritura, notas y factura de honorarios al cliente elegido. La etapa «Seña» sin
  cobro sólo registra el estado; el botón «Cobrar seña» registra el dinero.
- **Resumen:** vacantes, avisos de vencimiento/ajuste, morosidad, comisiones netas y
  netos pendientes de liquidar a propietarios, derivados de los registros guardados.

Los recibos liquidados al propietario y sus facturas de comisión no se pueden anular
sueltos desde Ventas: eso dejaría la liquidación sin respaldo. **Falta el circuito
coordinado de reversión** de esas liquidaciones. Las señas recibidas quedan como
anticipos del comprador; transferirlas al propietario y resolver devoluciones de
reservas no se automatizó. Las etapas no reemplazan boleto, escritura ni asesoramiento
legal. Son límites reales de esta primera implementación.

## Constructora

Sólo aparece al activar su módulo y respeta permisos por empresa.

- **Obras:** cliente, ubicación, fechas, responsable, estado y depósito propio.
- **Presupuesto:** rubros e ítems de materiales, mano de obra y subcontratos. Cantidades
  con hasta tres decimales; precios netos. Ítems globales con cantidad 1.
  Se pueden editar o quitar antes de que integren un certificado. Después se crea un
  ítem adicional o ampliación; no se altera lo ya certificado.
- **Certificados:** cantidades ejecutadas acumuladas por ítem, o avance porcentual
  acumulado del ítem global. No permite retroceder ni exceder el 100%. Primero calcula
  la vista previa; después el usuario confirma la emisión y facturación.
- **CAC:** índice base y mes base de la obra; índice del período con mes y fuente.
  El rezago de meses determina qué índice se admite. No usa índices ficticios como si
  fueran oficiales ni aplica CAC a una obra sin ese ajuste pactado.
- **Anticipo:** se registra antes del primer certificado. Se factura el neto más IVA y el recibo cancela esa factura. La devolución proporcional descuenta neto e IVA de los certificados.
- **Fondo de reparo:** 5% por defecto, configurable al crear la obra. Se calcula sobre
  básico más ajuste. No reduce la base de IVA: ya está facturado, queda retenido en cuenta corriente y se habilita su cobro al finalizar, sin emitir otra factura.
- **Cobros:** recibos sobre el neto facturado del certificado, con control de saldo.
- **Impresión:** certificado con mediciones y desglose completo, más factura asociada
  en el circuito existente de Ventas.
- **Costos:** imputación de compras confirmadas, limitada por su importe, o registro
  de mano de obra, subcontratos y gastos. Imputar no duplica la compra ni paga el gasto.
  Compras anuladas dejan de sumar como costo en el informe.
- **Subcontratos:** proveedor, importe y retención contractual; certificados del
  período limitados por el contrato y registrados una sola vez como costo. No generan
  automáticamente una factura fiscal del proveedor ni una orden de pago.
- **Acopio:** remito y transferencia entre depósito y obra; conserva la existencia
  total. Anular el remito revierte ambos movimientos, si hay stock para hacerlo.
- **Unidades/lotes:** precio, comprador y plan contractual de cuotas. Distribuye los
  centavos restantes en la última cuota y mantiene vencimientos al pasar por febrero.
  Ajuste fijo, manual o por coeficiente CAC del saldo pendiente, con fuente e historial;
  no admite repetir el ajuste de la misma cuota en el mismo mes. Cobros parciales con
  recibo y cuenta corriente. No emite automáticamente la factura fiscal de la unidad.
- **Informes:** presupuesto/costo, desvío, básico más CAC sin IVA, resultado sobre
  costos, certificados contra cobrado, anticipo pendiente, fondo retenido y cuotas
  pendientes/vencidas. El resultado depende de los costos que se hayan imputado.

### Regla de certificación aplicada

1. Básico del período: suma de `cantidad acumulada × precio unitario − importe básico
   ya certificado`, calculado por ítem. Para el global, se aplica su porcentaje a la
   cantidad 1 pactada.
2. Ajuste CAC: `básico × (índice del período / índice base − 1)`, en renglón separado.
3. Menos devolución de anticipo proporcional a la ejecución monetaria acumulada sobre
   el presupuesto vigente, restando devoluciones anteriores y sin superar el anticipo.
4. IVA sobre básico más CAC menos devolución del anticipo.
5. El reparo se retiene del total a cobrar, sin reducir el neto facturado ni su IVA. Se conservan además las percepciones fiscales aplicables del
   cliente; aparecen por separado y el total coincide con la factura guardada.

El porcentaje global sólo informa y sirve de referencia al avance: **no sustituye la
medición para calcular el básico**. Los cálculos monetarios proporcionales usan
enteros y redondeo en centavos. El certificado imprime el desglose; la factura lleva
el neto fiscal y referencia el desglose en sus notas.

Ejemplo de QA: presupuesto $1.000, anticipo $100, ejecución del período $200, índice
base 100 e índice de prueba 120. El anticipo se factura $100 + IVA $21 y se cobra $121.
Básico $200 + CAC $40 − devolución $20 = neto $220; IVA $46,20;
**factura $266,20**, reparo retenido $12 y cobro disponible $254,20.
Estos índices son ejemplos de prueba, no valores oficiales.

El criterio fiscal fue confirmado por el usuario: el reparo no descuenta IVA.
Las obras de QA con anticipos o certificados anteriores a esa confirmación se conservan
sin recalcular; se bloquea su continuación financiera hasta revisarlas.

No se habilitó anular por separado desde Ventas los comprobantes vinculados a anticipos,
certificados, liberación de reparo y cuotas: falta la reversión coordinada del circuito.
Los netos cero o negativos se rechazan; no se inventa una factura positiva para esos
casos. La emisión fiscal real sigue pendiente de verificar con ARCA.

## Contabilidad y percepción de la demo

Se tomó la alternativa expresamente permitida en el pedido: **ocultar Contabilidad**
hasta contar con asientos. No aparece en menú, activación ni matriz de puestos, y la
API rechaza su uso mientras esté deshabilitada. Se conserva el plan existente y la
opción de preparar datos base; no se anuncian libro diario, mayor ni exportación
Account Soft como funcionalidades implementadas.

La percepción IIBB del seed comercial queda sólo en dos clientes RI, identificados
con «DEMO IIBB 3%». La actualización reconoce los nombres/códigos originales del seed,
se aplica una sola vez y no recalcula comprobantes anteriores ni vuelve a pisar las
ediciones posteriores del usuario.

## Pruebas y alcance

Comando completo (requiere PostgreSQL local y un build actualizado):

```sh
npm run build
RUN_FLOW_TESTS=1 RUN_DB_TESTS=1 npm test
npm run lint
```

Las pruebas de circuitos crean una base temporal independiente y la eliminan al
terminar; las pruebas no vacían ni eliminan las empresas habituales de la demo.

La entrega incluye pruebas de alta/permiso global, primer alta sin membresías,
numeración por punto, confirmación, respaldo recuperable, escritura concurrente,
rechazo de un `CASCADE` entre empresas, aislamiento RLS, sesión de respaldo tras
eliminar la última empresa, alquiler/cobro/comisión/pago, ajuste y certificado por
cantidades/CAC/anticipo/reparo, acopio con reversión, costos, subcontratos y cuotas.
Los resultados de navegador y verificación final se registran en
[verificación de esta entrega](verificacion-empresas-rubros.md).

### Pendientes antes de producción

- CAE/QR y emisión ARCA real: el adaptador fiscal existente sigue sin implementarse
  ni verificarse contra el organismo. No se configuraron credenciales reales.
- Reversiones coordinadas de los nuevos circuitos financieros y devolución de
  depósitos/señas. Los bloqueos evitan desbalances, pero no reemplazan ese trabajo.
- Restauración desde una pantalla: sólo se probó la recuperación técnica en QA.
- Índices oficiales: carga manual de valores y fuentes; no hay actualización externa.
- Listados nuevos limitados a 100 registros por sección (presupuesto: hasta 500 ítems);
  falta paginación completa. Los selectores de fichas/artículos/compras permiten buscar.
- Los circuitos nuevos requieren conexión; no se agregaron a la cola offline.
  Se conservó y se verifica por separado el funcionamiento offline anterior.
- Impresora física y validación contable/fiscal/legal de los rubros.

Esta es una implementación funcional para revisión y pruebas de piloto. No es una
certificación de producción ni una afirmación de que todos los casos de negocio están
resueltos.
