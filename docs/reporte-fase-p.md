# Reporte de Fase P — prototipo local sin Docker

Fecha de ejecución: 21 de octubre de 2026.

## Resultado

La Fase P queda implementada y validada en Linux con Node.js 24.19.0, npm
11.9.0 y PostgreSQL Server 16.15 local. El
paquete standalone arranca sin `tsx`; las migraciones se resuelven respecto del
archivo compilado y funcionan aunque el comando se lance desde otro directorio.
No se avanzó a la Fase 0.

El defecto de doble cobro fue reproducido antes de los demás cambios con el
script fuente ejecutado desde el repositorio, Node.js 24.19.0 y PostgreSQL
16.15, en una base descartable: 5 de 5 pares produjeron dos respuestas HTTP
200, dos registros visibles por API y dos registros en PostgreSQL. Esa corrida
confirma el defecto, pero no validaba que la herramienta fuera autosuficiente
dentro del paquete.

La primera revisión del empaquetado ejecutó el script debajo de `.next` dentro
del repositorio. Node podía encontrar `postgres` en el `node_modules` superior,
por lo que el conteo “API + PostgreSQL” de esa corrida no se usa como evidencia
de independencia del standalone.

Después de corregirlo, esbuild generó `prueba-doble-cobro.js` con PostgreSQL
incluido. Se copió todo el standalone a un directorio temporal fuera del
repositorio y se confirmó que no contenía `node_modules/postgres`. Desde esa
copia se ejecutó:

| Configuración / variante | Pares | Duplicados | Errores | Conteo |
| --- | ---: | ---: | ---: | --- |
| Sin URL de PostgreSQL · anticipo | 1 | 1 | 0 | API; informó `DB=sin conteo` |
| Con `DATABASE_URL_ADMIN` · anticipo | 1 | 1 | 0 | API y PostgreSQL |
| Con `DATABASE_URL_ADMIN` · recibo real (`REC`) | 1 | 1 | 0 | API y PostgreSQL |
| Con `DATABASE_URL_ADMIN` · deuda exacta | 1 | 1 | 0 | API y PostgreSQL |

El script exige `TALON_PRUEBA_CONFIRMAR=DATOS_FICTICIOS`, usa un cliente nuevo
por par, conexiones HTTP independientes y PostgreSQL local para el conteo
opcional. La idempotencia no se corrigió porque corresponde a la Fase 0C.

## Cambios de la fase

- Next genera salida `standalone`.
- `package-standalone.mjs` copia `public`, `.next/static` y `drizzle`, compila
  migración, autorización de empresas, worker de respaldos y prueba de doble
  cobro con esbuild, copia las herramientas de ejecución y elimina archivos
  `.env` conocidos.
- `migrate` localiza `drizzle` desde su propio archivo.
- Los cargadores aceptan `TALON_ENV_FILE` para `C:\Talon\config\.env`.
- Se agregó un lanzador del standalone para el puerto 4318 y Node 24 quedó
  declarado en `engines`.
- Se incorporó el script de doble cobro compilado y autocontenido con las tres
  variantes de Fase P.
- Se agregó la guía manual y la lista de verificación para Windows.

## Verificado en este entorno

- Build de producción standalone y TypeScript: correcto con Node.js 24.19.0 y
  npm 11.9.0; no usa PostgreSQL durante el build.
- Suite general: 98 pruebas aprobadas; 15 integraciones omitidas por diseño en
  esa ejecución y corridas después con sus variables de habilitación.
- Integración RLS con el rol de aplicación: 1 de 1 aprobada.
- `npm run test:flows`: 14 de 14 circuitos HTTP aprobados con Node.js 24.19.0 y
  PostgreSQL 16.15. La salida terminó con `Test Files 1 passed` y
  `Tests 14 passed`.
- Lint: 0 errores y 4 advertencias preexistentes (dos de TanStack Virtual y dos
  por navegación con `window.location.assign`).
- `migrate.js` compilado desde una copia del standalone sobre una base vacía:
  correcto; aplicó las 28 migraciones con Node.js 24.19.0 y PostgreSQL 16.15.
- `empresa-autorizar.js` compilado desde esa copia: correcto; persistió el
  alcance `superadmin` con Node.js 24.19.0 y PostgreSQL 16.15.
- `backup-worker.js --once` compilado: creó respaldo.
- Standalone con configuración externa: `/api/health` respondió.
- `prueba-doble-cobro.js` desde la copia standalone sin
  `node_modules/postgres`: correcto con y sin `DATABASE_URL_ADMIN`.
- Las bases descartables se eliminaron al terminar.
- El paquete generado no contiene `.env` ni `.git`.
- Revisión de postinstall: en una copia limpia se ejecutó
  `npm ci --ignore-scripts` con Node.js 24.19.0 y npm 11.9.0; luego
  `npm run build:standalone` terminó correctamente. Esto verifica Linux y
  demuestra que en ese entorno los binarios opcionales alcanzan aun sin los
  postinstall.

## NO VERIFICADO

- Compilación del standalone en Windows y relocalización de sus enlaces.
- Efecto de bloquear los postinstall de `esbuild` y `unrs-resolver` en
  Windows. La compilación con `--ignore-scripts` solo se verificó en Linux; la
  guía incluye comprobación, reconstrucción manual y registro del resultado.
- Node portable y PostgreSQL portable en Windows.
- Dependencia del runtime de Microsoft Visual C++.
- Inicio de sesión desde otra PC por HTTP/LAN. Las cookies `Secure` en
  producción son un riesgo conocido que se trabaja en Fase 0A6.
- Firewall de Windows.
- Arranque en frío, servicios, orden PostgreSQL → app y reintentos. Fase P solo
  ofrece arranque manual; los servicios pertenecen a Fases 2 y 3.
- Prueba de doble cobro desde otra PC de la red.
- Integración ARCA, datos reales y circuitos productivos.

La fase necesita la ejecución de
`docs/lista-verificacion-vm-fase-p.md` en una VM antes de decidir ajustes o
autorizar la Fase 0.
