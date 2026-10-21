# Verificación de empresas y rubros · 21/10/2026

Trabajo realizado exclusivamente con PostgreSQL local y datos ficticios. No se desplegó ni se utilizó una base real. Guía: [Empresas y rubros](empresas-y-rubros.md). Alcance solicitado: [documento recibido](solicitud-cambios-pendientes.md).

## Resultado automatizado

- Build de producción y TypeScript correctos.
- Lint: cero errores y cuatro advertencias preexistentes (dos de navegación de sesión y dos de TanStack Virtual/React Compiler).
- `RUN_FLOW_TESTS=1 RUN_DB_TESTS=1 npm test`: **107 pruebas aprobadas en 26 archivos**, ninguna omitida.
- Diez pruebas HTTP de circuitos completos con servidor de producción y PostgreSQL aislado: ventas, cobros parciales, notas de crédito concurrentes, anulaciones, caja, stock, permisos, alta/vaciado/eliminación de empresas, inmobiliaria y constructora.
- Integraciones de seed y RLS ejecutadas, incluyendo una base recién creada.
- Respaldo de empresa comercial, inmobiliaria y constructora restaurado dentro de una transacción de prueba: comparación de todos los registros y posterior rollback. No existe todavía un botón de restauración.
- El respaldo incluye escrituras concurrentes confirmadas y el vaciado rechaza referencias cruzadas heredadas entre empresas sin borrar datos ajenos.
- Prueba de regresión: editar un puesto conserva sus permisos al repetir la preparación. Se reprodujo que antes el seed restauraba indebidamente los permisos predeterminados; ahora el puesto editado queda personalizado.
- Prueba fiscal: anticipo neto $1.000 + IVA $210 y certificados posteriores completan exactamente el neto y el IVA presupuestados, sin volver a facturar el reparo.
- No se modificaron dependencias ni el archivo de bloqueo.

## Navegador en producción local

Se usó Chromium con usuarios y registros de demostración:

- Alta desde Configuración, selección de rubro y dos puntos de venta, cambio a la nueva empresa, eliminación con nombre exacto y descarga efectiva del JSON de respaldo.
- Inmobiliaria: contrato, comisión configurable, cobro de alquiler y extras, liquidación y pago al propietario, sin duplicación de caja.
- Constructora: alta de obra, presupuesto por cantidades e ítem global, anticipo, vista previa CAC, emisión y certificado A4/PDF. La captura final corresponde al criterio fiscal confirmado: factura $266,20; reparo $12; disponible $254,20.
- Pantallas de 1440, 390 y 320 px en los recorridos probados, sin desbordamiento horizontal de la página ni errores JavaScript.
- Ventas: validación incompleta, F2/Enter/Ctrl+Enter, persistencia tras recarga, stock y caja por el importe guardado, impresión A4 no electrónica y separación de los textos Total/Estado.
- Laura en empresa comercial: sin solicitudes a `/api/estacion`, sin 403 ni errores de consola. Restricción de proveedores del vendedor comprobada por separado.

Las cinco regresiones offline del circuito existente se repitieron en producción local: aviso persistente, vale guardado localmente sin POST, provisorio, F5 offline y sincronización automática al recuperar conexión. La cola quedó vacía y hubo una sola creación en servidor. Los módulos nuevos requieren conexión.

## Archivos y cambios principales

| Grupo | Archivos |
| --- | --- |
| Persistencia y aislamiento | Migraciones `0016` a `0020`, esquema y pruebas de integración |
| Empresas y respaldos | `company-setup.ts`, dominio `company.ts`, servidor `company-management.ts`, formularios de Configuración, alta y respaldos |
| Inmobiliaria | Servidor `inmobiliaria.ts`, reglas y pruebas, pantalla y ruta propias |
| Constructora | Servidor `constructora.ts`, reglas y pruebas, pantallas, vista previa e impresión |
| Integración existente | Permisos, acceso, shell, sesión, editor de comprobantes, numeradores por punto de venta y resguardos de anulación |
| Demostración | Seeds por rubro, percepción IIBB identificada, preparación persistente y autorización global explícita |
| Documentación | Guía de uso, pedido recibido, este informe y capturas |

## Límites y pendientes reales

- ARCA real, CAE y QR fiscal no verificados. El entorno usa modo simulado; no habilitar producción por estas pruebas.
- Falta la reversión coordinada de los nuevos circuitos financieros. Se bloquea la anulación aislada de sus comprobantes para evitar saldos inconsistentes.
- Los registros de QA anteriores a la confirmación fiscal quedan conservados. Las obras con anticipos sin factura o certificados del criterio anterior bloquean la continuación financiera hasta revisarlas; no se recalcula su historial.
- No hay feed automático de índices oficiales, generación de contratos legales ni automatización de devolución/transferencia de depósitos y señas inmobiliarias.
- Subcontratos registran costo y retención; no generan la factura del proveedor ni su pago. Las cuotas de unidades son contractuales; no facturan automáticamente el inmueble.
- Contabilidad permanece oculta, como alternativa admitida en el pedido; no se implementaron diario automático ni exportación AccountSoft.
- Los listados nuevos tienen límite de 100 registros y el presupuesto 500 ítems; falta paginación integral para grandes volúmenes.
- El aviso transitorio de sincronización y la aparición de vales pendientes en Flota siguen como pendientes visuales separados; no se presentan como resueltos.

## Capturas

- [Inmobiliaria](capturas/inmobiliaria.png)
- [Constructora: cálculo y desglose](capturas/constructora.png)
- [Certificado imprimible](capturas/constructora-certificado.png)
