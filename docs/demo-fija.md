# Demo fija para trabajo diario

Preparada el 21/10/2026 en PostgreSQL 16 local, en la base separada
`talon_demo_fija`. No reemplaza la base `talon` ni usa información real.

## Abrir o volver a iniciar

Con dependencias instaladas, Docker/PostgreSQL iniciado y `.env.local` con las
conexiones locales de administrador y aplicación:

```sh
npm run demo
```

El comando crea la base sólo si falta, aplica migraciones, carga los datos iniciales
sólo una vez y arranca un build de producción en el puerto 4319. En la máquina
que lo ejecuta se abre `http://localhost:4319`. Usuario de demostración:
`laura@talon.demo`, clave `talon1234`. Elegir **Distribuidora Paraná**.

Para preparar únicamente los datos: `npm run demo:setup`.

Ambos comandos fijan explícitamente el nombre de la base y rechazan conexiones
PostgreSQL remotas. No es necesario cambiar `.env.local` ni la base habitual.
La aplicación conserva su rol limitado `talon_app`; el administrador sólo prepara
la base y sus datos. No se cambiaron permisos, lógica comercial ni dependencias.

## Escenarios nuevos

Buscar los clientes cuyo nombre comienza por **DEMO ·** y el artículo
**DEMO-FIJA-001**. Los importes siguientes corresponden a la carga inicial;
cambiarán al trabajar con la demo.

| Cliente | Historial inicial | Saldo |
| --- | --- | ---: |
| Cliente con saldo y devolución | Dos facturas, devolución parcial y cobro parcial | $1.273,00 a cobrar |
| Cliente con anticipo | Recibo previo a la factura | $200,00 a favor del cliente |
| Cliente con descuento 10% | Factura de cuatro unidades con descuento | $435,60 a cobrar |

El artículo tiene precio neto de $100, IVA 21% y existencia inicial de 100 unidades.
Después de los movimientos de los escenarios quedan **83 unidades**. Hay precios
cargados en las listas comerciales para poder seguir vendiéndolo desde el formulario.

La demo también conserva las empresas, usuarios, compras, pedidos, remitos y
artículos ficticios del seed original. La carga completa dejó 43 clientes y 88
comprobantes entre todas las empresas.

## Verificación realizada

- Preparación inicial completada con migraciones y seed.
- Segunda ejecución: mismos clientes, documentos y movimientos, sin duplicados.
- Saldos de los tres clientes y stock contrastados directamente con PostgreSQL.
- API de producción: ingreso y consulta de cuentas; al detener y volver a iniciar
  el servidor e ingresar en una sesión nueva se obtuvieron exactamente las mismas
  cuentas y saldos. Los registros y movimientos se conservaron.
- El comando de arranque completo genera build de producción y TypeScript.
- Navegador Chromium sobre ese arranque: ingreso, selección de Distribuidora,
  apertura de cuentas y cliente demo, consulta de los tres saldos y recarga de
  pantalla. Sin errores de JavaScript.
- Lint: cero errores, cuatro advertencias preexistentes.

Esta comprobación no certifica todos los recorridos. Los escenarios se cargaron
mediante la lógica comercial existente; el anticipo ficticio se prepara con esa
lógica, no representa una nueva validación del formulario de anticipos.
Siguen pendientes ampliar compras/pagos, remitos/facturas, cierres de caja y ARCA.

## Conservación de los datos

Cerrar la aplicación no borra la base. Docker guarda PostgreSQL en el volumen
`talon-data`, ya definido en `docker-compose.yml`. Volver a ejecutar `npm run demo`
conserva las operaciones que se hayan agregado; no restablece los saldos iniciales.

Esto es persistencia dentro de este entorno, no alojamiento público ni garantía de
conservación si se elimina el entorno o el volumen. No hay que ejecutar
`docker compose down -v` si se quiere conservarlo. Para trasladarlo o conservar
una copia independiente:

```sh
docker compose exec -T db pg_dump -U talon_admin -Fc talon_demo_fija > talon-demo-fija.dump
```

No subir el dump al repositorio si posteriormente contiene información real.
