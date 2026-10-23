# Mejoras de Impuestos

## T1 · Moneda extranjera

- La liquidación convierte IVA, crédito y percepciones a pesos con `round(cents × tipo_cambio)` por alícuota.
- LID, CSV y XLSX expresan importes en pesos y conservan moneda y tipo de cambio.
- La base conserva los valores originales.
- Prueba: importar el fixture DOL y calcular 202609; USD 210 con TC 1050,5 aporta 22.060.500 centavos.

## T2 · Períodos confirmados

- La importación comprueba el cierre antes de crear `imp_import_jobs`.
- Los errores PostgreSQL 55000 se reconocen también dentro de `cause` y se traducen a 409.

## T3 · Período y fecha

- AAAAMM acepta 01–12 y años 2000–2100.
- Ventas de otro período y compras futuras se rechazan. Compras anteriores entran con revisión por cómputo diferido.

## T4 · Condición de IVA

- Lista única: RI, monotributo, exento, consumidor final y no alcanzado.
- Migración 0039 normaliza valores inválidos a RI, deja auditoría y agrega CHECK.
- F.2002 devuelve 409 para sujetos que no son RI. Los exentos conservan la exportación LID.

## T5 · Correcciones menores

- Un receptor distinto del titular queda con aviso y revisión.
- El vencimiento de pago se conserva cuando el archivo trae la columna y ocupa el campo 22 del LID.
- El ZIP omite archivos vacíos.
- TODO documentado: el README asigna permisos de Contabilidad al Contador aunque el módulo está intencionalmente apagado. No se modificó por estar fuera de alcance.

## T6 · IVA Simple

- Migración 0040: esquema por cliente e inicio configurable.
- Selección pura entre IVA Simple, F.2002/LID, LID exento y no corresponde.
- Resumen F.2051 por alícuota y certificados en `GET /api/impuestos/iva-simple/resumen`.
- Los endpoints de liquidación, reapertura y exportación reutilizan el cierre y los diseños comprobados.
- TODO: CSV “Ajustes y otros conceptos”. El PDF con columnas y códigos no está en el repo; no se inventó el formato.

## F1 · Retenciones y percepciones sufridas

- Migración 0042 con aislamiento por estudio y empresa cliente.
- API CRUD, duplicados, cierre de período y ventana origen+5 para percepciones.
- Pantalla de carga y consulta por período dentro de Ventas.
- La liquidación suma automáticamente certificados del período de cómputo; los campos manuales quedan como otros importes.
- TODO: importador oficial, pendiente del diseño de ARCA.

## F2 · Prorrateo

- Destino del crédito por compra: directo gravado, directo exento o prorrateable.
- Coeficiente automático por ventas y coeficiente manual configurable y auditado.
- La liquidación guarda el coeficiente usado.
- TODO: ajuste anual, pendiente de una fuente oficial inequívoca.

## F3 · Retenciones y percepciones practicadas

- Migración 0045 modela sujeto, régimen, base, alícuota, importe, fecha, comprobante y certificado con RLS.
- TODO: exportaciones SIRE F.2005 y SICORE F.744. Los diseños oficiales de registro no están disponibles localmente; no se inventaron posiciones.

## F4 · Vencimientos

- Migración 0043 global con fuente URL y fechas oficiales indicadas para 09/2026.
- Helper probado para todas las terminaciones y visualización en la empresa fiscal.

## F5 · Comprobantes manuales

- API de alta, edición de origen manual y baja lógica con control de período, duplicado, tipo, documento, total, IVA, crédito B/C y tolerancia.
- Clasificación para prorrateo y auditoría.
- Formulario visual de alta dentro de Ventas y Compras.
- Endpoint para deshacer un lote mediante baja lógica, motivo y auditoría.

## F6 · Diseños especiales

- TODO: servicios importados, TurIVA y bienes usados. El repo no contiene los diseños oficiales; no se generan archivos vacíos ni formatos supuestos.

## Migraciones

- 0039 condición IVA.
- 0040 configuración IVA Simple.
- 0041 vencimiento de pago.
- 0042 certificados sufridos.
- 0043 calendario.
- 0044 prorrateo.
- 0045 certificados practicados.
