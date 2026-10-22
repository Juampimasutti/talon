# Fuentes de las tablas ARCA — obtenidas el 22/10/2026 (America/Buenos_Aires, UTC-3)

WSFE = WSFEv1 **homologación** `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`, autenticado vía WSAA homo
(`/workspace/facturador/app/wsaa.py`, cert `facturador/certs/homologacion.crt`, CUIT 20410436885). Las respuestas crudas y los archivos oficiales acompañaron el ZIP entregado; el repositorio conserva los CSV normalizados y esta trazabilidad. El material crudo no participa del runtime ni de las migraciones.

| Tabla / CSV | Filas | Fuente |
|---|---|---|
| imp_condiciones_iva.csv | 11 | https://www.arca.gob.ar/fe/documentos/TABLA-TIPO-RESPONSABLES-V.0-06022025.xls + WSFE `FEParamGetCondicionIvaReceptor` (RG 5616; coinciden los 11 códigos; columna extra `ws_cmp_clase_receptor`) |
| imp_tipos_comprobante.csv | 133 | Unión de https://www.arca.gob.ar/iva/documentos/Libro-IVA-Digital-Tablas-del-Sistema.pdf (§3, 121 códigos; descripción preferida), https://www.arca.gob.ar/fe/documentos/TABLACOMPROBANTES.xls (97) y WSFE `FEParamGetTiposCbte` (36; fecha vigente_desde). Columna `fuente` indica cuál. |
| imp_alicuotas.csv | 6 | WSFE `FEParamGetTiposIva` = PDF Libro IVA Digital §1 (ya cargadas en 0029; ON CONFLICT las respeta) |
| imp_codigos_operacion.csv | 9 | PDF Libro IVA Digital §2 "Códigos de Operación" |
| imp_monedas.csv | 53 | WSFE `FEParamGetTiposMonedas` (49) + 4 sólo en PDF Libro IVA Digital (007, 027, 036, 039; no vigentes en WSFE) |
| imp_tipos_documento.csv | 36 | WSFE `FEParamGetTiposDoc` (mismo set que PDF Libro IVA Digital "Tipo de Documento") |
| arca_tipos_tributo.csv | 18 | https://www.arca.gob.ar/fe/documentos/otros_Tributos.xlsx + WSFE `FEParamGetTiposTributos` (11). **No hay tabla imp_ destino en 0029-0031 → no se inserta en SQL.** |
| imp_matriz_letras.csv | 55 | RG 5003/2021 art. 20 y 21 (texto: https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5003-2021-350574/texto ; Título V vigente desde 01/07/2021 por art. 28 b) + WSFE `FEParamGetCondicionIvaReceptor` (Cmp_Clase) |

Extras crudos (no seeded): FEParamGetTiposOpcional, FEParamGetTiposConcepto, OperacionCondicionIVA.xls.

## No verificado / derivado (revisar)
- **vigente_desde = 1900-01-01** es un centinela: ARCA no publica fecha de alta (condiciones IVA, códigos de operación, comprobantes no presentes en WSFE, 4 monedas LIVA). Para códigos en WSFE se usó FchDesde oficial.
- **imp_tipos_comprobante: letra, clase, signo, discrimina_iva, usa_ventas, usa_compras son DERIVADOS** de la descripción (no vienen de ARCA). letra vacía cuando la descripción no la indica (30-33, 37, 38, 49, 66, 70, 80, 83, 88-91, 99, 110, 331, 332, 99x). E asignada a exportación (19-22). discrimina_iva = letra A/M o despacho 66. usa_ventas/usa_compras = true en todos (sin fuente oficial de restricción).
- Código 51-54: WSFE los describe como "A con leyenda Operación Sujeta a Retención"; Libro IVA Digital como "M". Se usó la descripción LIVA, letra M.
- Código de operación "0": el PDF dice "(espacio) o 0 (cero)"; sólo se carga '0'.
- talon_tax_condition: mapeo propio (1→ri; 6,13,16→monotributo; 5→cf; 4→exento; resto NULL).
- Matriz: RI→RI/Monotributo(6,13,16) {A,M} verificado en texto RG 5003 (RG 1415 art.15 a; RG 1575 art.6). RI→resto {B} y emisores 4/6/13/16→todos {C}: según RG 1415 art. 15 b)/c) **cuyo texto no se descargó**; coherente con Cmp_Clase de WSFE. Exento (4) emitiendo C no está confirmado por texto. Letra E (exportación, WSFEX) no incluida. Sólo se carga la versión vigente desde 01/07/2021 (no la matriz anterior, RI→monotributo B).
