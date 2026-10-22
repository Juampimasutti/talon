# Módulo de impuestos — Etapa 1

Rama: `feat/impuestos-etapa1`.

## Alcance implementado

- **F1:** 19 tablas `imp_` (7 referencias globales y 12 tablas por empresa), módulo optativo, seis permisos y RLS.
- **F2:** libros IVA Ventas/Compras y “Traer de Talón” idempotente. El proceso lee `documents`, `document_lines` y `document_taxes` y sólo escribe snapshots en tablas `imp_`.
- **F3:** parser XLSX de Mis Comprobantes por encabezados, validación de CUIT del titular, notas de crédito, B/C sin crédito, residuos, tolerancia de $0,05, contrapartes, deduplicación y alta opcional en Talón apagada por defecto.
- **F4:** generador declarativo de ancho fijo con CRLF y control de longitud por línea. Se mantienen pendientes la validación externa en ARCA y la revisión manual de los diseños de Ventas contra el PDF oficial vigente.
- **F5:** cálculo del borrador F.2002, confirmación y bloqueo del período, reapertura con `impuestos.anular`, motivo obligatorio y `audit_log`. Una liquidación confirmada sólo vuelve a borrador mediante esa reapertura.

El ejemplo del brief produce un total a pagar de **$5.050,00**.

## Respaldo

Las 12 tablas `imp_` con `company_id` participan de `company_snapshot` y de la restauración genérica por dependencias. Las 7 referencias globales se recuperan mediante las migraciones de la versión y no se duplican dentro de cada respaldo.

## Referencias y validaciones externas pendientes

Las fuentes de ARCA devolvieron HTTP 403 desde este entorno. Se cargó únicamente el subconjunto de tipos necesario para los fixtures y las seis alícuotas indicadas explícitamente por el brief. Siguen pendientes la tabla oficial completa, los códigos de operación, monedas, documentos, condiciones IVA y la matriz de letras.

También siguen pendientes:

- Importar los TXT en el servicio real Libro IVA Digital con CUIT de prueba.
- Confirmar contra el PDF vigente cada campo de los registros de Ventas.
- Criterios del estudio marcados PENDIENTE en el brief (prorrateo anual, comprobantes B/C recibidos, Dec. 814 y antigüedad del crédito fiscal).
- La comprobación manual en Windows detallada en `docs/impuestos-etapa1-prueba-windows.md`.

## Aislamiento del instalador

No se modificaron `INSTALAR-TALON.cmd`, `ABRIR-TALON.cmd`, `windows/`, `next.config.ts` ni `scripts/package-standalone.mjs`. La prueba de Fase P en la otra PC continúa en pausa y fuera de esta rama.
