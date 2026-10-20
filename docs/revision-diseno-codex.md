> Informe histórico de la revisión visual. Para el estado posterior a las correcciones, leer [reporte-bugs-actualizado.md](reporte-bugs-actualizado.md).

# Revisión visual de Talón v26 — 20/10/2026

Se continuó desde talon_v26_diseno_checkpoint (1).zip. El contenido del nuevo ZIP coincidía con el punto de continuación ya importado. La referencia visual se usó para presentación, sin agregar datos ficticios, métricas ni funciones.

## Archivos de presentación modificados en esta revisión

- `src/app/globals.css`: cabecera fija, menú lateral con altura de pantalla, saldos destacados y filas de tablero más compactas. Reglas limitadas a pantalla para el menú y el formulario.
- `src/components/shell/panel-shell.tsx`: navegación con desplazamiento propio; selector de empresa y salida accesibles en páginas largas. Eventos, permisos y enlaces conservados.
- `src/components/virtual-table.tsx`: indicación de desplazamiento horizontal en móvil y región accesible por teclado. Se conserva rowHeight=46, virtualización y eventos de filas.
- `src/components/documentos/editor-screen.tsx`: cabecera de formulario en dos columnas en móvil, sin cambiar orden de campos, atajos, valores, validaciones ni eventos. Aviso de desplazamiento en tabla.
- `src/components/directorio/directorio-screen.tsx`: eliminación del texto técnico sobre virtualización; se mantiene cantidad de fichas y funcionamiento de filtros y formulario.

Los ocho archivos del rediseño anterior no se revirtieron. Los cambios anteriores de ingreso, botones, campos, layout y tablero se conservan.

## Integridad

Los 95 hashes de `docs/verificacion-archivos-diseno.json` se comprobaron nuevamente: todos coinciden. Lógica, API, permisos, cálculos, dependencias, migraciones, sincronización y service worker permanecen idénticos. `next-env.d.ts` y `public/shell-assets.json` fueron regenerados por las herramientas de Next y el script de producción; son salidas ignoradas por Git.

## Validación real

Entorno local aislado de demostración: PostgreSQL 16 en Docker Compose, rol restringido talon_app, Node 24.19.0, Next.js 16.4.2. No se usó base real ni se desplegó.

- `npm run build`: correcto, incluidas comprobaciones TypeScript.
- `RUN_DB_TESTS=1 npm test`: 19 archivos, 78 pruebas aprobadas, ninguna omitida. Incluye aislamiento RLS y migraciones/seed sobre base limpia.
- `npm run lint`: 18 errores y 13 advertencias, igual que el punto de continuación; no se desactivaron reglas.
- Navegador Chromium real, API y PostgreSQL reales, servidor de producción local en puerto 4318.
- Laura, empresa comercial: sin llamadas a `/api/estacion`, sin respuestas HTTP fallidas ni errores JavaScript en el recorrido comprobado.
- Venta incompleta: muestra validación sin emitir. Venta al contado por formulario usando F2, Enter y Ctrl+Enter: emitida y recuperada después de recargar. Artículo ART-00100, stock del depósito central de 106 a 105; Caja aumentó 45.308 centavos, igual al total de $453,08. Se conserva una venta de QA identificada por la nota "QA rediseño visual - demo local" en la base demo.
- Impresión: generado PDF A4 de esa venta no electrónica, con datos y total. CAE/QR reales no probados.
- Alta de cliente desde formulario móvil, guardado y reapertura: nombre, localidad y teléfono persistidos. Cliente de QA identificado como "QA visual cliente demo" en la base demo.
- Mostrador: acceso directo a API de proveedores devuelve 403 esperado. La prueba RLS comprueba que no ve proveedores ni clientes de otra empresa.
- Tablero, clientes, nueva venta y Caja a 1440, 390 y 320 px: sin desbordamiento horizontal de página. Las tablas mantienen su desplazamiento interno.
- Selector de empresa y Salir visibles en Caja larga; navegación entre empresas comprobada durante la prueba de estación.

## Cinco verificaciones de producción del reporte v26

1. Aviso Sin conexión visible y persistente durante la comprobación de 5 segundos.
2. Vale de 2 litros de Nafta súper guardado en IndexedDB sin ningún POST mientras no había conexión. Provisorio abrió con cliente, cantidad e importe de $2.400,00.
3. Recarga F5 sin conexión: estación, pestaña Flota y cola local recuperadas.
4. Reconexión: sincronización automática observada en aproximadamente 1 segundo en esta ejecución. Cola vacía y un vale adicional persistido en servidor. Se conserva ese vale de QA en la demo; no se simuló su resultado.
5. Laura en empresa comercial: sin solicitudes innecesarias de estación ni 403 ni errores de JavaScript en el recorrido.

## Pendientes y límites reales

- La plantilla autónoma del provisorio offline todavía usa serif: proviene de `public/sw.js`. Se dejó intacto ese archivo protegido; la pantalla funciona, pero no coincide plenamente con la tipografía del rediseño.
- Se conserva el lint previo pendiente (18 errores, 13 advertencias).
- CAE y QR fiscales no validados. La demo emite sin autorización electrónica y el adaptador real de ARCA no está implementado.
- Impresión validada como PDF en Chromium; no se probó una impresora física ni otros motores de navegador.
- Los pendientes menores históricos (aviso transitorio de sincronización, visibilidad de vales pendientes y extracción textual TOTALESTADO) se mantienen separados; no se cambiaron ni se dieron por corregidos. La prueba valida guardado/sincronización, sin caracterizar cada transición visual de esos pendientes.
- No se certifican todos los circuitos comerciales ni aptitud para producción con estas pruebas. No se hizo despliegue, commit ni push.

## Archivos entregados

El ZIP de entrega contiene fuentes, este informe y capturas del tablero y formulario móvil. No contiene `.env.local`, credenciales, node_modules, `.next`, datos PostgreSQL ni archivos Git. Se debe ejecutar el flujo documentado de instalación y `npm run local:prod` para regenerar los assets y reproducir la prueba offline.
