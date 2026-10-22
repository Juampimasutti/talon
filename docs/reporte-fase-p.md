# Reporte de Fase P — prototipo local sin Docker

Fecha de ejecución: 21 de octubre de 2026.

## Resultado

La Fase P queda implementada y validada en Linux con PostgreSQL 16 local. El
paquete standalone arranca sin `tsx`; las migraciones se resuelven respecto del
archivo compilado y funcionan aunque el comando se lance desde otro directorio.
No se avanzó a la Fase 0.

El defecto de doble cobro fue reproducido antes de los demás cambios, en una
base descartable: 5 de 5 pares produjeron dos respuestas HTTP 200, dos registros
visibles por API y dos registros en PostgreSQL. La base de prueba fue eliminada.

Después del empaquetado se probaron tres variantes, tres pares por variante:

| Variante | Pares | Duplicados | Errores | Conteo |
| --- | ---: | ---: | ---: | --- |
| Anticipo con descripción única | 3 | 3 | 0 | API y PostgreSQL |
| Recibo real (`REC`) | 3 | 3 | 0 | API y PostgreSQL |
| Deuda exacta sin anticipo | 3 | 3 | 0 | API y PostgreSQL |

El script exige `TALON_PRUEBA_CONFIRMAR=DATOS_FICTICIOS`, usa un cliente nuevo
por par, conexiones HTTP independientes y PostgreSQL local para el conteo
opcional. La idempotencia no se corrigió porque corresponde a la Fase 0C.

## Cambios de la fase

- Next genera salida `standalone`.
- `package-standalone.mjs` copia `public`, `.next/static` y `drizzle`, compila
  migración, autorización de empresas y worker de respaldos con esbuild, copia
  las herramientas de ejecución y elimina archivos `.env` conocidos.
- `migrate` localiza `drizzle` desde su propio archivo.
- Los cargadores aceptan `TALON_ENV_FILE` para `C:\Talon\config\.env`.
- Se agregó un lanzador del standalone para el puerto 4318 y Node 24 quedó
  declarado en `engines`.
- Se incorporó el script de doble cobro con las tres variantes de Fase P.
- Se agregó la guía manual y la lista de verificación para Windows.

## Verificado en este entorno

- Build de producción standalone y TypeScript: correcto.
- Suite general: 98 pruebas aprobadas; 15 integraciones omitidas por diseño en
  esa ejecución y corridas después con sus variables de habilitación.
- Integración RLS con el rol de aplicación: 1 de 1 aprobada.
- Circuitos HTTP con PostgreSQL aislado: 14 de 14 aprobados.
- Lint: 0 errores y 4 advertencias preexistentes (dos de TanStack Virtual y dos
  por navegación con `window.location.assign`).
- Migrador JavaScript desde un directorio distinto: correcto.
- `empresa-autorizar.js` compilado: correcto.
- `backup-worker.js --once` compilado: creó respaldo.
- Standalone con configuración externa: `/api/health` respondió.
- PostgreSQL: migración, seed, autorización, respaldo y nueve carreras; las
  bases descartables se eliminaron al terminar.
- El paquete generado no contiene `.env` ni `.git`.

## NO VERIFICADO

- Compilación del standalone en Windows y relocalización de sus enlaces.
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
