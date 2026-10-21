# Talón: mejoras de rendimiento

Revisión sobre la versión de GitHub `f150db3`. Se leyó el reporte adjunto `reporte-mejoras-talon.md`. Se conservaron cálculos, permisos, aislamiento por empresa, contratos de API, dependencias y esquema de datos. Trabajo y mediciones realizados con la base local de demostración.

## 1. Renders innecesarios

La tabla tenía filas memoizadas, pero Clientes/Proveedores, Artículos y Comprobantes creaban de nuevo sus callbacks al renderizar el formulario o filtro. Eso invalidaba la memoización de las filas aunque los datos no hubieran cambiado.

Los callbacks ahora son estables y la tabla compartida también está memoizada. Se conservan el valor de cada fila, el callback vigente, la virtualización y rowHeight=46. Las pruebas usan el componente VirtualTable real con la ventana virtual controlada: dos filas se calculan dos veces al montar y siguen en dos después de dos actualizaciones con props estables. El control con callbacks nuevos termina en seis. Otra prueba cambia datos y callback y verifica que se ejecute la acción nueva, evitando cierres obsoletos.

## 2. Bundle y lazy loading

- Equipos se carga mediante un import dinámico cuando se abre su pestaña en Estación.
- La biblioteca QR se importa al necesitar un QR en impresión, no al abrir cualquier comprobante. La impresión automática espera a que el SVG esté listo; una prueba con generación demorada verifica que el diálogo no se abra antes. No se cambió el contenido ni el cálculo fiscal del QR.
- Excel ya tenía import dinámico en el servidor y se conservó.
- Las rutas ya estaban separadas; no se presenta ese trabajo previo como una mejora nueva.

| Módulo | Antes, gzip inicial | Después, gzip inicial | Cambio |
|---|---:|---:|---:|
| Impresión | 16.786 bytes | 7.515 bytes | −55 % |
| Estación | 75.213 bytes | 73.722 bytes | −2 % |

Medición aislada con Esbuild, con React y Next externos y suma de chunks estáticos compartidos. No equivale al peso completo de una página Next.js ni a una medición de tiempo de carga. Es el efecto de diferir esas funcionalidades sobre el grafo del módulo; el código diferido sigue existiendo y el precache de producción puede descargarlo en segundo plano para permitir trabajar sin conexión.

Se corrigió `npm run measure:bundle`: ahora distingue bytes iniciales de bytes totales, incluye QR/Estación, usa splitting y trabaja en memoria. Ya no genera archivos de entrada sobrantes dentro del repositorio. `docs/bundle.json` documenta explícitamente que el monolito es una comparación sintética.

## 3. Requests y caching

- Desarrollo: no se registra el service worker ni se ejecuta el precache de producción. No hace falta fabricar un manifiesto de assets de producción para next dev. El modo offline continúa reservado al build de producción.
- Producción: el precache evita volver a descargar los recursos con hash de `/_next/static/` que ya están en CacheStorage. No se aplica esa omisión a datos operativos cambiantes.
- Las lecturas de sesión, catálogos y referencia del precache comparten las peticiones en vuelo con apiGet. También se comparte el ping de salud concurrente; su resultado no queda cacheado indefinidamente.
- El identificador de peticiones en vuelo cambia al iniciar/limpiar sesión. Una consulta de la empresa anterior no se reutiliza para la siguiente aunque ambas tengan la misma URL.
- Las referencias offline se agrupan por scope usuario/empresa y se descarta una respuesta si cambió el scope durante su carga.
- La clave de caché del mayor de cuentas incluye la empresa. Se conservaron no-store en operaciones y las políticas de catálogos, sin ampliar TTL de datos comerciales.

Las pruebas cubren ping concurrente, ausencia de precache en desarrollo, cambio de sesión durante un GET y cambio de empresa durante la carga de referencias. El recorrido de producción vuelve a comprobar cola offline, recarga, provisorio y sincronización con persistencia.

## 4. Consultas lentas y N+1

### Caja

La consulta de saldos ejecutaba una subconsulta correlacionada de MAX(created_at) de apertura para cada movimiento. En EXPLAIN ANALYZE sobre la carga de prueba se repitió 5.027 veces. Se reemplazó por un agregado de aperturas por caja y un JOIN; conserva saldo histórico y saldo desde apertura.

Se agregaron 5.000 movimientos dentro de una transacción que terminó en rollback. Medianas de tres ejecuciones calentadas con los mismos datos:

| Consulta | Tiempo |
|---|---:|
| Subconsulta por movimiento | 1.459,461 ms |
| Aperturas agrupadas | 3,261 ms |

Los resultados fueron iguales. Esta medición usa el administrador de la demo para comparar planes SQL; no es la latencia de la API ni una promesa de velocidad en una base real. También se comparó la respuesta real de /api/caja con la consulta anterior sobre los datos demo, incluidos balances y sessionBalances: coincide.

### Artículos y precios

La búsqueda paginada leía todos los precios de la lista, incluso al pedir ocho artículos o un SKU. Ahora incorpora el precio con un LEFT JOIN a la página de productos. Mantiene precios nulos, conteo, orden y filtros. Pasa de tres consultas a dos cuando se pide una lista; sin lista se sigue devolviendo null.

Con 5.000 productos/precios de prueba, el camino anterior devolvía 5.720 filas de precios y el nuevo devuelve solo las ocho filas de la página. La prueba real de API contrastó ocho precios con la base y comprobó el caso sin lista. Los datos de carga se revirtieron.

Se revisaron los caminos de lectura de listados, detalle, informes y estación: usan joins o consultas agrupadas. No se encontró un N+1 clásico de una lectura por fila en esos recorridos; el problema repetitivo reproducido fue el subplan de Caja. Los bucles de escrituras transaccionales de stock no se paralelizaron: preservan orden, bloqueo y validaciones.

## 5. Imágenes, fuentes y scripts

| Archivo | Antes | Después |
|---|---:|---:|
| icon-192.png | 2.822 bytes | 2.452 bytes |
| icon-512.png | 11.041 bytes | 7.064 bytes |

Reducción conjunta de 4.347 bytes (31 %). Se compararon los buffers de píxeles decodificados y son idénticos; no cambian dimensiones ni formato del manifest.

La aplicación ya usa Segoe UI/Arial/Helvetica del sistema. El recorrido de navegador registró cero descargas de fuentes y cero solicitudes a orígenes externos. No se agregaron fuentes remotas ni scripts de terceros. La ilustración WebP existente no se carga en las pantallas actuales y no se recomprimió para inventar un ahorro de red.

## Observaciones del adjunto resueltas

- Se evita el pedido del manifiesto de producción en desarrollo.
- La columna Estado tiene borde y separación propios respecto de Total.
- La grilla de Nueva venta alinea arriba sus bloques para que el aviso de stock no estire los campos de impuestos.
- Nombre comercial, Razón social y Localidad tienen etiquetas visibles y accesibles en Configuración.
- Cuentas corrientes muestra un resumen calculado sobre los saldos reales ya recibidos, sin preseleccionar una cuenta ni disparar una lectura adicional del mayor.

## Validación y límites

- Build de producción y TypeScript: aprobados.
- Desarrollo en navegador: ingreso y tablero correctos, cero pedidos de shell-assets.json, cero service workers registrados y cero respuestas HTTP fallidas.
- 23 archivos de prueba; 88 pruebas aprobadas, cero omitidas, con PostgreSQL real de demo.
- Lint: cero errores, cuatro advertencias previas (TanStack Virtual y navegación completa de sesión). No se desactivaron reglas.
- Navegador real: validación de venta incompleta, venta persistida con atajos, stock menos una unidad, Caja más el total de $453,08 y PDF de impresión.
- Recorrido de producción offline: vale persistido sin POST, visible tras volver y hacer F5, provisorio, sincronización automática, sin duplicados. Laura comercial sin peticiones de estación ni errores JavaScript.
- Pantallas a 1440, 390 y 320 px sin desbordamiento horizontal de página.
- Precios, saldos históricos y saldos de sesión contrastados con SQL anterior; labels y resumen de cuentas comprobados en navegador.
- Se conservan fixtures de QA funcional en la demo. Las cargas de medición masiva terminaron en rollback.
- CAE/QR reales, impresora física, latencias de producción y carga con usuarios concurrentes reales siguen fuera de estas comprobaciones. No se desplegó ni se usó una base real.

Las evidencias de consultas, módulos, imágenes y auditoría de navegador se guardan en `docs/rendimiento/`. Para repetir comprobaciones: `RUN_DB_TESTS=1 npm test`, `npm run lint`, `npm run build` y `npm run measure:bundle`. Para el recorrido offline: `npm run local:prod`.
