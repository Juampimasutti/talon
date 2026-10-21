# Circuitos comerciales verificados — 21/10/2026

Se ejecutaron cinco pruebas nuevas contra la API HTTP de un servidor Next en modo
producción y PostgreSQL 16 local. Cada ejecución crea una base con nombre aleatorio,
aplica migraciones y seed, y la elimina al terminar. No modifica la demo habitual,
una base real ni un despliegue. Las solicitudes usan el usuario de aplicación; las
consultas administrativas se reservan para preparar fixtures y contrastar saldos.

## Resultados

Las cinco pruebas aprobaron. No se reprodujeron fallos nuevos en estos escenarios.
No fue necesario modificar lógica comercial.

El artículo de prueba tiene precio neto de 10.000 centavos e IVA 21%; la venta de
dos unidades totaliza 24.200 centavos ($242). Se contrastaron movimientos de stock,
existencias en `stock_levels`, caja y cuenta corriente después de cada etapa.

| Recorrido | Resultado comprobado |
| --- | --- |
| Venta a cuenta → cobro parcial → anular recibo → anular venta | Stock disminuye dos unidades, deuda aumenta por el total, cobro reduce deuda y aumenta caja por igual. Las anulaciones restituyen los saldos iniciales. Una segunda anulación devuelve 400 sin duplicar movimientos. El comprobante se recupera mediante otra petición con total, estado y renglón persistidos. |
| Venta al contado → nota de crédito total | Venta aumenta caja y reduce stock sin deuda; la nota devuelve ambos saldos al inicial. Otra nota que excede el importe disponible devuelve 409 sin modificar saldos. |
| Venta sin stock suficiente | Devuelve 409; no queda documento nuevo ni movimiento parcial en stock, caja o cuenta corriente. |
| Dos notas de crédito simultáneas | Ambas intentan acreditar 1,5 de las dos unidades vendidas. Una se confirma y otra devuelve 409; sólo quedan los movimientos de la aceptada. Anular la nota y la venta restituye los saldos. |
| Permisos y empresa | Héctor, contador, puede consultar la venta pero recibe 403 al emitir o anular. Laura en Costa recibe 404 al consultar la venta de Distribuidora. Las solicitudes rechazadas no alteran los saldos finales. |

## Repetición

Con PostgreSQL local iniciado, dependencias instaladas y `.env.local` configurado
para la demo (`DATABASE_URL_ADMIN` y `DATABASE_URL`):

```sh
npm run test:flows
```

El comando reconstruye producción y ejecuta las cinco pruebas. Rechaza URLs de
PostgreSQL que no apunten a localhost. Usa puertos dinámicos y elimina únicamente
la base temporal que acaba de crear. El administrador local debe poder crear bases.

Verificación adicional de esta entrega:

- Build de producción y TypeScript: aprobados.
- Suite habitual con PostgreSQL: 88 aprobadas. Las cinco nuevas se omiten en el
  comando habitual porque requieren activación explícita; se ejecutaron y aprobaron
  por separado con `npm run test:flows`.
- Lint: cero errores y las mismas cuatro advertencias previas, sin advertencias nuevas.

## Alcance pendiente

Esta entrega comprueba API, persistencia y efectos contables de los recorridos
listados. No automatiza clics del navegador ni reemplaza las pruebas visuales y
offline anteriores, que no se repitieron aquí. Tampoco simula una caída o reinicio
de PostgreSQL.

Faltan ampliar los recorridos de compras y pagos a proveedores, pedidos → remitos
→ facturas, cierres de caja, límites de crédito, todos los perfiles de permisos,
devoluciones por artículo y escenarios de concurrencia distintos del probado.
CAE/QR con ARCA e impresora física siguen pendientes. Los resultados no certifican
que todos los circuitos estén libres de errores ni constituyen aprobación de producción.

Archivos de esta entrega: `src/lib/db/business-flows.integration.test.ts`,
`package.json` (comando de ejecución) y este informe. Sin nuevas dependencias,
migraciones ni cambios funcionales.
