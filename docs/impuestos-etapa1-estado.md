# Módulo de impuestos — Etapa 1

Rama de trabajo: `feat/impuestos-etapa1`.

## F1: esquema y referencias

Estado: base técnica implementada; referencias oficiales incompletas.

- Migraciones `0029`, `0030` y `0031` con 22 tablas `imp_`.
- Esquema Drizzle separado en `src/lib/db/schema-impuestos.ts`.
- Módulo optativo `impuestos` y seis permisos asignables.
- Menú y ruta visibles solamente cuando la empresa habilita el módulo y el rol
  tiene `impuestos.ver`.
- RLS por empresa en todas las tablas operativas y referencias globales de solo
  lectura para sesiones autenticadas.
- Bloqueo en base para comprobantes de períodos cerrados.
- Tablas propias para libros, importaciones y borradores de liquidación. No se
  alteraron `documents`, `document_lines`, `document_taxes`, clientes,
  proveedores ni empresas.
- Las alícuotas 0%, 2,5%, 5%, 10,5%, 21% y 27% quedaron cargadas con los códigos
  informados por la tabla del Libro IVA Digital.

## Verificación ejecutada

- Migración de una base vacía: 31 migraciones y 22 tablas `imp_`.
- Actualización simulada desde una base con las primeras 28 migraciones: aplicó
  `0029` a `0031` y terminó con 31.
- RLS en PostgreSQL: 2/2 pruebas aprobadas, incluida la separación entre dos
  empresas y un usuario sin permisos de impuestos.
- Suite general: 99 aprobadas y 16 omitidas por requerir variables de
  integración.
- `npm run test:flows`: 14/14 circuitos aprobados, incluidos respaldo,
  restauración, inmobiliaria y constructora.
- Build de producción y TypeScript: correctos.
- Lint: 0 errores y las mismas 4 advertencias conocidas.

## Pendientes normativos antes de completar F1

El 22 de octubre de 2026, las URLs oficiales de ARCA indicadas en el brief
respondieron HTTP 403 desde este entorno. Para evitar inventar datos, permanecen
vacías las tablas de condiciones IVA, tipos de comprobante, códigos de
operación, monedas, tipos de documento y matriz de letras. Deben cargarse desde
las tablas oficiales completas y revisarse antes de habilitar el módulo con
datos fiscales.

Fuentes a reintentar:

- <https://www.arca.gob.ar/libro-iva-digital/documentos/>
- <https://www.arca.gob.ar/ws/documentacion/manuales.asp>
- <https://www.arca.gob.ar/fe/documentos/manual-desarrollador-ARCA-COMPG-v4-0.pdf>

## Aislamiento respecto del instalador

Esta rama no modifica `INSTALAR-TALON.cmd`, `ABRIR-TALON.cmd`, `windows/`,
`next.config.ts`, `scripts/package-standalone.mjs` ni la documentación de la
Fase P. La prueba pendiente en otra PC con Windows continúa fuera de este
trabajo.
