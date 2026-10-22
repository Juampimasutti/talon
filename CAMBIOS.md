# CAMBIOS – Impuestos etapa 1

## Pulido de estudio y configuración fiscal

- Configuración del estudio ya no muestra “General”; Auditoría es su único subítem y conserva `auditoria.ver`.
- Se quitó el selector transversal de las pantallas fiscales. Libro IVA Ventas y Liquidación quedan dentro de Ventas; Libro IVA Compras queda dentro de Compras.
- Informes queda deshabilitado para estudios desde la sesión y la API, incluso si una instalación anterior lo conserva en `enabled_modules`.
- Auditoría se muestra dentro de Configuración en el menú del estudio, pero conserva su permiso `auditoria.ver` y su ruta independiente.
- El encabezado identifica el entorno como “Estudio contable”.
- En modo estudio, “Empresas” reemplaza al tablero y muestra tarjetas de clientes. “Impuestos” contiene Ventas, Compras y Configuración de la empresa seleccionada.
- El nombre y CUIT seleccionados permanecen visibles en escritorio y celular. La selección se conserva al navegar.
- Un puesto sin `impuestos.ver` no ve Empresas ni Impuestos y entra en Configuración en vez de caer en “Sin permiso”.
- El alta de estudios ya no pide ni envía un rubro. La base conserva un valor interno por compatibilidad con el esquema existente.
- Configuración general oculta stock, caja y módulos comerciales cuando la empresa es un estudio.
- Configuración fiscal permite guardar por cliente puntos de venta, actividades, tolerancia y la opción predeterminada de crear contrapartes en Talón. Cada cambio queda en `audit_log`.
- El total del Libro IVA queda fijo en el borde derecho y las contrapartes, incluido “Consumidor final”, permanecen en una línea.
- La cookie funciona en una instalación local abierta por HTTP desde otro equipo de la red. En una publicación HTTPS se activa `TALON_COOKIE_SECURE=1`.
- Verificación: TypeScript y build correctos; lint sin errores (3 advertencias conocidas); 135 pruebas unitarias, 10 pruebas DB/RLS y 14 circuitos completos aprobados.

## Árbol de empresas clientes (Parte 1)

### Decisión de modelo
- Se adoptó `imp_empresas` dentro del tenant del estudio. Cada cliente fiscal tiene su propio CUIT, condición de IVA y rubro sin convertirse en una empresa operativa de Talón.
- `company_id` continúa siendo el límite de RLS entre estudios. `empresa_cliente_id` separa comprobantes, importaciones, períodos, saldos, liquidaciones y configuración dentro de cada estudio.
- Las relaciones internas usan claves compuestas con ambos identificadores para impedir cruces accidentales entre clientes.

### Migración 0038
- Crea `imp_empresas`, RLS, índices y baja lógica.
- Crea una empresa cliente predeterminada por cada empresa existente y vincula allí todos los datos `imp_` anteriores.
- Agrega `empresa_cliente_id` a las 12 tablas fiscales del tenant, sin borrar datos.
- Una instalación con un solo cliente mantiene compatibilidad automática. Cuando hay varios, PostgreSQL exige seleccionar uno mediante el contexto fiscal.
- Las empresas nuevas reciben su cliente fiscal inicial automáticamente. El respaldo y la restauración incluyen ahora 13 tablas de Impuestos.

### Interfaz y API
- Impuestos es un árbol lateral con las empresas activas, CUIT y acceso para agregar otra.
- Alta, edición y baja lógica con auditoría (`impuestos.empresa.crear`, `editar` y `baja`).
- Encabezado permanente con nombre, razón social y CUIT de la empresa seleccionada.
- Rutas separadas para Compras, Ventas, Libro de IVA, Liquidación y Configuración.
- En esta Parte 1 las subsecciones muestran datos mínimos aislados y avisan que el contenido operativo se completa en la Parte 2.
- Las rutas planas anteriores redirigen al árbol para evitar operar sin una empresa cliente identificada.

### Seguridad comprobada
- Dos clientes del mismo estudio pueden tener el mismo período y sólo ven sus propios datos.
- Un estudio no puede seleccionar ni escribir sobre clientes de otro tenant.
- Las reglas previas se conservan: sólo Contador accede a Impuestos y el módulo sigue oculto para comercio/distribuidora y estación.

### Verificación de esta entrega
- TypeScript: correcto.
- Lint: 0 errores y 4 advertencias preexistentes.
- `npm test`: 131 aprobados y 24 omitidos (las suites de integración se ejecutaron por separado).
- `test:db`: 10/10 aprobados, incluidos aislamiento por cliente y RLS entre estudios.
- `test:flows`: build de producción correcto y 14/14 circuitos aprobados.
- Migración y seed desde base vacía: correctos.
- Actualización desde `0037` con datos: correcta; conservó configuración, período y comprobante en la empresa cliente predeterminada.

## Parte 1 – Kit único y rubros
- Se borró ELEGIR-MODO-TALON.cmd. Hay un kit único, sin la pregunta N/E.
- Gating en el servidor: `effectiveModules` se aplica al cargar la sesión.
  - Distribuidora, estación, comercio (y un sector nulo) pierden `impuestos` aunque figure en `enabled_modules`.
  - Estudio lo conserva siempre.
  - La API devuelve 403.
- El toggle de Configuración no ofrece impuestos para esos rubros.
- Interacción entre las reglas: el rubro decide si el módulo existe. Dentro de un estudio, la regla de solo-Contador decide quién lo usa.

## Parte 2 – Bugs
1. Libro IVA:
   - TXT RG 4597 de ventas y compras, con alícuotas, más el TXT de importación.
   - Descarga en ZIP.
2. CUIT normalizado a dígitos en todo el sistema:
   - Consumidor final = 99/"0".
   - Migración 0037 normaliza los datos existentes.
3. Liquidación:
   - Saldo técnico y saldo de libre disponibilidad se manejan por separado, con arrastre automático desde el período confirmado anterior.
   - Inputs para retenciones, percepciones, pagos a cuenta y Dec. 814.
   - Se guarda el detalle en `imp_liquidacion_items`.
   - Caso de prueba: total a pagar $ 5.050,00.
   - Archivos: `calculos.ts`, `src/server/impuestos.ts`, `liquidacion-screen.tsx`, `liquidacion-detalle.tsx`.
4. Moneda PES (la migración convierte '$' a PES).
5. "Crear también en Talón" carga `tax_condition` y el tipo de documento.
6. Traer de Talón (`traer-de-talon.ts`):
   - No pisa el período.
   - Deduplica contra Mis Comprobantes y reporta los omitidos.
7. Recalcular un período confirmado devuelve 409 con el mensaje "reabrilo indicando el motivo".
8. Pantallas e impresión:
   - Libros por alícuota con totales (`libro-tabla.tsx`).
   - Liquidación legible.
   - Las impresiones muestran importes (`impresion-impuestos.tsx`).
- Además: se corrigió el escape `\\D` en las regex SQL de `importar.ts` y `traer-de-talon.ts`.

## Pruebas
- tsc: limpio.
- Lint: 0 errores (4 warnings previos).
- vitest: 140 passed, 14 skipped.
- test:db: 9/9.
- test:flows: 14/14, incluye arrastre, 409 y gating por rubro.
- Migraciones: OK sobre DB vacía y como upgrade.

## Pendiente
- En pantallas angostas la tabla del libro scrollea en horizontal.
- Crear una empresa requiere que el operador esté en `company_operators` (comportamiento previo).
