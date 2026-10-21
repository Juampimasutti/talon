# Talón v26: correcciones de bugs — 20/10/2026

Este informe actualiza los resultados de `reporte-bugs-v26.md` y `revision-diseno-codex.md`, que se conservan como historial. El usuario autorizó continuar con correcciones funcionales después del rediseño visual.

## Corregido y reproducido

### Vales pendientes que desaparecían de Flota

Antes: un vale de 3 litros quedaba en IndexedDB pero no se veía en Flota al volver del provisorio o hacer F5 offline. La prueba de navegador registró cero filas locales en ambos casos, aunque la sincronización posterior funcionaba.

Ahora: las filas se reconstruyen desde la cola persistida del usuario y empresa activos. Muestran "Pendiente de sincronizar"; sobreviven al regreso y a F5. Después de aplicar la sincronización se retira la fila local y queda la del servidor. No se cambió el cálculo del vale, la numeración ni el protocolo de envío. El acceso a operaciones pendientes se mantiene limitado al scope activo.

Se corrigió además una deduplicación por contenido que ocultaba un vale nuevo si coincidían cliente, patente, combustible y litros con otro ya guardado. Dos operaciones distintas pueden tener el mismo contenido; las claves identifican las operaciones y el servidor mantiene su idempotencia. Las pruebas cubren dos vales idénticos y la exclusión de operaciones ajenas o sin propietario.

### Selección de empresa compartida entre sesiones

Reproducido al ejecutar los recorridos comercial y estación en dos sesiones de Laura: una pantalla conservaba el nombre de estación mientras la API tomaba la última empresa elegida desde otra sesión. `getAuth` ignoraba la cookie de empresa y usaba siempre la preferencia global guardada del usuario.

Ahora usa la cookie de cada sesión, validada contra sus membresías. La empresa guardada se conserva como alternativa para sesiones antiguas sin esa cookie. No se agregaron permisos ni se alteró RLS. Prueba unitaria de regresión y comprobación en dos contextos reales de navegador: empresas y permisos separados.

### Encabezados y provisorio

- Se agregó separación de texto entre encabezados de la tabla virtual. Extracción real de la lista de ventas verificada con `Total\s+Estado`.
- La plantilla autónoma offline usa Segoe UI/Arial/Helvetica. Solo se cambió su declaración de fuente; se conservó el funcionamiento del service worker.

## Errores de lint

Se corrigieron los 18 errores sin desactivar reglas ni agregar dependencias:

- Valores predeterminados de comprobante/lista/depósito y empresa derivados de los datos cargados, evitando efectos que copiaban estado.
- Formularios respaldados por almacenamiento local montados después de hidratar; recuperación de operaciones para editar al inicializar cada formulario.
- Selección de vehículo/chofer derivada del cliente cuando hay una única opción, conservando la edición manual.
- Valores de aforadores derivados de la lectura guardada más las ediciones locales.
- Inicialización diferida de fechas; nombres locales `moduleKey`; descarga de backup identificada como descarga.
- Dependencias de hooks e imports sin uso corregidos.

Resultado: lint termina con código 0, cero errores y cuatro advertencias: dos de compatibilidad del compilador con TanStack Virtual y dos recomendaciones sobre navegación completa en ingreso/salida. Se conservaron esas recargas completas de sesión.

## Pruebas finales

- Build de producción y TypeScript: aprobados.
- 20 archivos de pruebas, **81 pruebas aprobadas**, ninguna omitida. PostgreSQL 16 real, incluidas RLS y migración/seed en base limpia.
- Cinco comprobaciones offline sobre producción local: aviso persistente, vale en IndexedDB sin POST, apertura de provisorio, F5 sin red y sincronización automática, más Laura comercial sin peticiones a estación ni 403 ni errores JavaScript.
- Vale de 3 litros: una fila pendiente tras regresar y tras F5; al recuperar red, cola vacía, exactamente un vale adicional en servidor y ninguna fila pendiente. Sincronizó en aproximadamente 1 segundo en esta ejecución.
- Observador de DOM durante el recorrido offline: cero apariciones de "En línea" mientras `navigator.onLine` era falso.
- Venta de contado guardada desde UI con F2/Enter/Ctrl+Enter. Stock ART-00100 de 104 a 103; Caja aumentó $453,08, igual al total. Recuperada después de recargar.
- Impresión de la venta no electrónica: PDF A4 generado.
- Cliente guardado y reabierto en móvil con datos persistidos.
- Configuración cargada, guardada sin cambiar sus valores y recargada.
- Edición de vale pendiente: recuperación de cliente, patente, producto y litros. Edición de entrega de reparto: recuperación de litros.
- Mostrador: 403 esperado al intentar consultar proveedores; pruebas RLS aprobadas.
- Tablero, clientes, venta y caja a 1440, 390 y 320 px: sin overflow horizontal de página.
- Dos sesiones del mismo usuario, una comercial y otra de estación: selección independiente confirmada mediante la API.

Las pruebas usan exclusivamente la demo local. Se conservan registros de QA en esa base; no se usó una base real ni se desplegó.

## Pendientes reales

- El aviso transitorio histórico de "En línea. Sincronizando" no se reprodujo en el recorrido instrumentado. No se declara corregido; no se alteró el motor de conectividad para intentar resolver un fallo no reproducido.
- CAE/QR fiscales continúan sin validación real: falta el adaptador ARCA y su configuración. No se inventaron autorizaciones ni se pidió una credencial para simularlas.
- No se probó impresora física ni se certificaron todos los circuitos comerciales o navegadores. Estas verificaciones no constituyen una aprobación para producción.

## Archivos e integridad

El manifiesto `verificacion-archivos-diseno.json` conserva la comparación histórica anterior al arreglo de bugs. Ya no corresponde afirmar que sus 95 archivos son idénticos: en esta fase se modificaron explícitamente lógica de selección de sesión, reconstrucción de filas offline y tests. Otros cambios en archivos protegidos son nombres locales para lint, imports sin uso y la fuente del provisorio.

`verificacion-correcciones-codex.json` registra los archivos actuales, hashes y diferencias respecto de la entrega visual. No cambiaron package.json, package-lock.json, migraciones, esquema de datos, cálculos fiscales, stock ni reglas de permisos. Los cambios de permisos.ts y sus tests son solo nombres locales de variables. La altura de fila virtual sigue en 46 px.

## Verificación adicional · 21/10/2026

Se reprodujo y corrigió la pérdida de permisos personalizados al repetir el seed:
los puestos editados se marcan como personalizados. Prueba de regresión incluida.
Las cinco comprobaciones offline históricas se repitieron en producción local.
El alcance, evidencia y pendientes de empresas y rubros están en
[el informe de verificación](verificacion-empresas-rubros.md).
