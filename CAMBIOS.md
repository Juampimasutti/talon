# CAMBIOS – Impuestos etapa 1

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
