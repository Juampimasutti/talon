# Talón v26: reporte de bugs

Versión: v26 (commit e4892502). Tests: 77 OK, 1 omitido (RLS).
Fecha: 20/10/2026. QA hecho sobre la versión de producción.

## Verificación final v26: 5 de 5 OK
1. El aviso "Sin conexión" aparece y queda visible.
2. Vale offline: se guarda en el dispositivo y no hace POST. El provisorio abre bien y al volver la estación funciona.
3. Recarga (F5) sin conexión: la página anda.
4. Al reconectar, sincroniza solo en unos 10 segundos.
5. Laura (Administración): no hay llamadas a /api/estacion ni error 403 y la consola no tiene errores.

## Pendientes conocidos (no se mandaron a arreglar)

### Estación / modo offline
- **Baja:** Sin conexión, el aviso muestra un instante "En línea. Sincronizando…" y después vuelve a "Sin conexión" (vista Flota, después de F5).
- **Baja:** El vale pendiente no aparece en la lista de Flota hasta que se sincroniza. Mientras tanto solo se ve en el contador "1 pendiente". Puede ser así por diseño.

### Ventas
- **Cosmética:** En la extracción de texto, el encabezado de la tabla se lee "TOTALESTADO" (Total y Estado pegados). En pantalla se ve bien.

## Sin probar
- Factura electrónica con CAE y QR: la empresa demo no emite comprobantes electrónicos.

## Notas
- El modo offline funciona solo en la versión de producción (`npm run local:prod`), no en la de desarrollo.
- IVA 10,5%: está soportado por artículo (tasas 0 / 10,5 / 21 / 27%). No hay un selector de tasa por línea.

## Historial
- v20: 2 críticos, 11 medios, 13 bajos. Corregidos.
- v21: 7 de 7 corregidos (impresión, vínculo de la NC).
- v22: anulación, NC duplicada, recibos, doble facturación, mermas, offline, pedidos redundantes. Corregidos.
- v23 a v25: caja (arqueo), provisorios offline, sincronización, signos, formulario de login. Corregidos.
- v26: hidratación offline, 403 de Laura, aviso offline, skeleton. Corregidos y verificados.
