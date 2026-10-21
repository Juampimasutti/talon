# Talón

Mejoras y mediciones actuales: [reporte de rendimiento](docs/reporte-rendimiento.md).

Demo persistente con escenarios ficticios: `npm run demo`. [Preparación, acceso y datos](docs/demo-fija.md).

Gestión comercial horizontal para Argentina. Sirve para una distribuidora, un comercio, un depósito o un estudio: cada empresa prende los módulos que usa. La interfaz está en español rioplatense.

La demo incluye Distribuidora Paraná, Costa & Asociados, Estación Almafuerte, Inmobiliaria Demo y Constructora Demo. Laura puede cambiar entre ellas desde el menú. [Guía de empresas, inmobiliaria y constructora](docs/empresas-y-rubros.md).

## Por qué este stack

- **Next.js, React y TypeScript.** Una sola app para la interfaz y la API, con una pantalla por ruta. Así el editor de comprobantes no viaja cuando abrís el tablero.
- **Tailwind y shadcn/ui.** Botones, diálogos y pestañas accesibles, con una paleta propia (papel y verde) en vez del tema genérico.
- **Postgres en cualquier lado.** La app habla SQL por `DATABASE_URL`. Sirve Postgres local, el de Docker, Neon o Supabase en el plan gratis. No hay SDK de un proveedor.
- **Drizzle.** Consultas tipadas sobre esas tablas, sin atarte a un host.
- **RLS en Postgres.** El rol de la aplicación no es superusuario y no puede saltear políticas. Cada pedido corre dentro de una transacción que fija la empresa y el usuario. Los permisos del puesto también se chequean en la API, así que un vendedor no entra a compras ni aunque arme el request a mano.

No hace falta pagar nada para correrla.

## Cómo correrla

Requisitos: Node 22 y un Postgres 16. Si tenés Docker:

```bash
docker compose up -d
cp .env.example .env.local
npm install
npm run local
```

`npm run local` aplica las migraciones, carga la demo si falta y abre [http://127.0.0.1:4317](http://127.0.0.1:4317).

Sin Docker, creá la base y los dos roles (el de migraciones tiene que poder crear objetos; el de la app no puede ser superusuario ni tener `BYPASSRLS`):

```sql
CREATE ROLE talon_admin LOGIN PASSWORD 'talon_admin' SUPERUSER;
CREATE ROLE talon_app LOGIN PASSWORD 'talon_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE talon OWNER talon_admin;
```

Después `npm run local` con el `.env.local` apuntando a ese servidor. El script de migración crea `talon_app` si todavía no existe y el usuario admin puede hacerlo.

Otros comandos: `npm test`, `npm run build`, `npm run db:explain`.

La prueba sin red de la estación (recargar y volver del comprobante provisorio) se hace con el build de producción, no con `next dev`: el overlay de desarrollo no se puede hidratar. `npm run local:prod` compila, arma la lista de chunks y abre http://127.0.0.1:4318 . El dev sigue en el 4317.

### Usuarios de la demo

La clave de todos es `talon1234`.

| Mail | Puesto | Qué puede hacer |
| --- | --- | --- |
| laura@talon.demo | Administración | Todo, en las empresas demo |
| mateo@talon.demo | Mostrador | Clientes, ventas, pedidos y remitos. No ve compras ni configuración |
| sofia@talon.demo | Caja | Caja y cobranzas |
| julian@talon.demo | Depósito | Stock y remitos |
| carla@talon.demo | Compras | Proveedores, compras y artículos |
| hector@talon.demo | Contador | Mira y exporta. No carga ni anula |
| marina@talon.demo | Administración | Solo Costa & Asociados |
| ramiro@talon.demo | Encargado de playa | Estación Almafuerte |
| luciana@talon.demo | Playera | Solo carga su turno en la estación |
| oscar@talon.demo | Chofer | Reparto a granel de Estación Almafuerte |

## Conectar Neon o Supabase

Los dos tienen un Postgres gratis. No uses su API de datos: pegá la connection string.

1. Creá el proyecto y copiá la URL **directa** (en Supabase, la del puerto 5432, no el pooler en modo transacción para las migraciones).
2. Ponela en `DATABASE_URL_ADMIN`.
3. Entrá con un cliente SQL y creá el rol de la app, sin superusuario y sin `BYPASSRLS`. En Supabase el usuario `postgres` a veces saltea RLS: no lo uses como `DATABASE_URL`.
4. `DATABASE_URL` tiene que ser ese rol restringido. `npm run db:migrate` y `npm run db:seed`.
5. Si igual entrás con un rol que saltea RLS, el tablero muestra un aviso. Los permisos de la API siguen activos, pero el aislamiento de la base no.

`set_config(..., true)` es local a la transacción, así que también funciona detrás de un pooler en modo transacción (Supabase 6543 o el pooler de Neon) para el runtime. Las migraciones conviene correrlas por la conexión directa.

Para un Postgres propio, cambiá las dos URLs y listo. El esquema está en `drizzle/*.sql` y el runner es `scripts/migrate.ts`.

## Importar y exportar

Entrá a **Datos** en el menú. También hay un enlace Exportar en clientes, proveedores y el resto de los listados: baja lo que coincide con el filtro, no solo la página que estás viendo.

Se puede importar y exportar clientes, proveedores, artículos, listas de precios, stock inicial, comprobantes de venta y de compra (incluido el archivo de Mis Comprobantes de ARCA, emitidos o recibidos), el plan de cuentas y los campos personalizados de la empresa. Los formatos son Excel (`.xlsx` y `.xls`), CSV y TXT separado por punto y coma, coma, tabulación o ancho fijo.

El asistente detecta las columnas, propone el mapeo por el nombre y deja guardar esa plantilla. La vista previa marca CUIT inválido, condición de IVA vacía o rara, duplicados y totales que no cierran. Recién al confirmar se graba, en una transacción y por lotes. Si falta la condición de IVA se puede completar con una regla (el prefijo del CUIT) o poner la misma a todas las filas vacías. Cada importación queda en Auditoría y se puede deshacer.

El backup de la empresa es un Excel con una hoja por entidad y se vuelve a importar eligiendo «Backup completo». Las plantillas de ejemplo se bajan desde la misma pantalla. Excel se carga solo en el servidor cuando hace falta, no en el resto de las pantallas.

Un vendedor puede importar y exportar clientes y ventas. No puede tocar compras. El contador exporta y no importa.

## Estación de servicio

El módulo se prende por empresa. En la demo está activo solo en **Estación Almafuerte** (`estacion-almafuerte`). Entrá con `luciana@talon.demo` (playera: abre y carga su turno) o `ramiro@talon.demo` (encargado: precios, tanques, descargas y facturación de flota). Laura también está en esa empresa y puede cambiar desde el menú.

Cubre surtidores y picos, precios de nafta, gasoil y GNC con fecha y hora, aforadores de inicio y cierre, litros y pesos del turno, diferencia contra lo cobrado y lo facturado, planilla con efectivo, tarjeta, QR, cuenta corriente y vales, tanques con varilla y merma, descargas de proveedor, flota (patente, chofer, límite y vale) y la factura periódica. El shop y los lubricantes salen de los artículos de siempre y, si controlan stock, lo descuentan del depósito Shop.

Los precios de surtidor de la demo son inventados. El ITC y el impuesto al CO2 se cargan en centavos por unidad, con tratamiento `interno` o `no_gravado` y un flag de si entran en la base del IVA. Por defecto quedan fuera: se restan del precio final y el resto se divide por 1 + alícuota. En una factura C (emisor que no es responsable inscripto) no se discrimina IVA.

Conviene que un contador confirme, antes de usar esto en una estación real:

- Si el ITC de combustibles líquidos va como impuesto interno y el impuesto al dióxido de carbono como no gravado, o si alguno de los dos cambió de tratamiento.
- Si los dos quedan fuera de la base del IVA también en GNC. En la demo el GNC no tiene esos importes.
- Si descomponer el precio de surtidor (restar el fijo y sacar el IVA del resto) coincide con el criterio que usa la estación y con AFIP.
- La letra: la demo es responsable inscripto y el cliente de flota también, así que sale factura A. Un emisor monotributista tiene que salir C, sin IVA discriminado.
- El redondeo puede dejar 1 centavo entre el IVA guardado y `base × alícuota`.
- El shop y los lubricantes llevan el IVA del artículo, separado de los impuestos del combustible. La planilla de playa anota el importe; no arma una factura mezclada con el combustible.
- Percepciones de ingresos brutos no se calculan sobre el combustible en este módulo.

## Informes y migración

En **Informes** están ventas, compras, libro IVA, cuentas, antigüedad, stock, mermas, caja, turnos, vales, reparto y rentabilidad. Se filtran por fecha y depósito, se bajan a Excel y se imprimen para guardarlos como PDF.

En **Datos** también entran archivos DBF de Visual FoxPro (CLIENTES, PROVEEDO, ARTICULO, LISTAPRE, CUENTAS) y el Excel de Mis Comprobantes. Antes de confirmar se puede probar la importación en una empresa de ensayo, comparar totales y después pasarla a la empresa real. El deshacer del lote sigue en esa misma pantalla. Los saldos iniciales de clientes, proveedores, stock, tanques y caja se cargan por `/api/migracion/saldos`.

## Sin conexión

Talón se puede instalar como aplicación (hay un manifest y un service worker). En la playa, el shop, los vales de flota y las entregas del reparto, si no hay red la operación queda en este dispositivo con una clave para no cargarla dos veces. Arriba se ve el cartel y cuántas faltan sincronizar. Al volver la conexión se mandan en orden. Si el stock del servidor no alcanza, no se descuenta: gana el servidor y la diferencia queda para revisar. Una factura hecha sin red se imprime como comprobante provisorio, sin CAE, y se numera al sincronizar por el mismo puerto de ARCA.

La pantalla de la estación se carga aparte del resto del panel. El código de sincronización también entra recién cuando hace falta. El tablero de playa junta productos, precios e impuestos en tres consultas y resuelve el precio vigente en memoria. Tanques e informes hacen una consulta agrupada, sin un ida y vuelta por pico.

## Qué hace

- Empresas con módulos activables, rubros libres y campos extra por cliente, proveedor o artículo.
- Puestos editables. Cada permiso es módulo + acción: ver, crear, editar, anular, exportar.
- Clientes y proveedores con CUIT validado y condición frente al IVA.
- Artículos con varias listas de precios, alícuota y stock por depósito.
- Comprobantes configurables. Al emitir, la letra sale del emisor y del receptor: A entre responsables inscriptos, B del responsable inscripto al resto, C si el emisor es monotributo o exento. A y B discriminan IVA; C no. Se puede sumar percepción de IIBB y otros tributos.
- Pedidos, remitos, compras, caja, cuentas corrientes, plan de cuentas y auditoría.
- La facturación electrónica no llama a ARCA. `src/lib/fiscal/arca.ts` define el puerto (`ElectronicInvoicingPort`) y los tipos de comprobante ya guardan el código AFIP. Con `ARCA_MODE=live` el alta intenta autorizar y, hasta que haya un adaptador de verdad, falla con un mensaje claro en vez de inventar un CAE.

## Informe de las cinco optimizaciones

Medidas en esta máquina, con la demo cargada. Los comandos son `npm test`, `npm run measure:bundle` y `npm run db:explain`. El detalle de los planes quedó en `docs/explain.txt` y el del bundle en `docs/bundle.json`.

### 1. Renders

Las filas de las tablas largas están en un componente memoizado: si cambia el texto del buscador y el dato de la fila no, la fila no se vuelve a pintar. El test `src/lib/ui/render-budget.test.tsx` lo cuenta.

- Con memo: 2 filas se pintan 2 veces, y después de dos cambios del filtro siguen en 2.
- Sin memo, el mismo tipeo las pinta 4 veces.
- La ventana virtual (`visibleWindow`) sobre 1200 filas, alto de 640 px y fila de 44 px, monta menos de 40 nodos. Clientes y artículos usan `@tanstack/react-virtual` con eso. El estado del buscador vive en la pantalla, no en el layout, así que tipear no redibuja el menú.

### 2. Bundle

Cada ruta importa su pantalla con `next/dynamic`. Un bundle único de las 14 pantallas, minificado y sin contar React ni Next, pesa **85,3 KB gzip** (271 KB sin comprimir). El tablero solo pesa **6,9 KB gzip**. La pantalla más pesada (clientes) pesa 64,9 KB gzip porque arrastra la tabla virtual y los diálogos, y aun así no incluye el editor de comprobantes ni la configuración.

`next build` parte el cliente en 34 chunks. El editor de ventas no se descarga al abrir el tablero.

### 3. Pedidos y caché

- TanStack Query deduplica la sesión (`staleTime` 60 s) y los catálogos (5 min). Los listados usan 15 s y `keepPreviousData` para no parpadear al paginar.
- Los GET en vuelo con la misma URL se juntan en `src/lib/api/inflight.ts`. El test comprueba que dos llamadas simultáneas pegan una sola vez.
- Los listados paginan en el servidor (40 o 80 filas). No viaja el padrón entero.
- `GET /api/catalogos` responde `Cache-Control: private, max-age=60, stale-while-revalidate=120`. El resto de la API operativa va con `private, no-store` y se invalida la query al emitir, cobrar o editar.

### 4. Consultas

Índices por empresa y fecha, más trigrama en nombres y SKU. El listado de ventas es un join, no una consulta por comprobante. La ficha trae cabecera, renglones e impuestos en paralelo, no un viaje por renglón.

| Consulta | Resultado |
| --- | --- |
| Nombre en el padrón demo (723 artículos) | 0,57 ms. El plan recorre la tabla: con tan pocas filas es lo correcto |
| SKU exacto | 0,034 ms, index scan en `products_company_sku_idx` |
| Nombre entre 40.000 artículos, índice trigrama | 2,8 ms, bitmap sobre `products_name_trgm` |
| La misma búsqueda, recorrido secuencial forzado | 17,5 ms |
| Listado de ventas con el tipo | 0,10 ms, un solo hash join |
| 40 comprobantes pidiendo renglones uno por uno | 4,0 ms y 40 idas |
| Esos 40 renglones en un join | 1,1 ms y una ida |

Los 40.000 artículos se insertan y se borran en la misma transacción del script. No quedan en la demo.

### 5. Imágenes, fuentes y scripts

- La ilustración del ingreso es un WebP de **13,6 KB** (960×1280, calidad 68), generado desde un SVG con `sharp`. `next/image` puede servirla en AVIF o WebP. En el celular no se pide: el panel está oculto.
- El rediseño actual usa Segoe UI, Arial o Helvetica del sistema; no descarga fuentes remotas. Las mediciones históricas de esta sección corresponden a la versión anterior: el reporte enlazado al inicio documenta el estado actual.
- No hay analytics ni otro script de terceros. Los íconos entran en el bundle de la ruta que los usa.

## Qué quedó pendiente

- El adaptador real de ARCA (certificado, WSAA y WSFE). El contrato ya está.
- Asientos automáticos a partir del comprobante. El plan de cuentas está cargado para consultar y ampliar.
- Pasar un pedido a remito y el remito a factura en un solo paso.
- PDF, mail y talonario impreso.
- Percepciones de IIBB por jurisdicción y padrón. Hoy es un porcentaje en la ficha del cliente.
- Más de un punto de venta por empresa.
