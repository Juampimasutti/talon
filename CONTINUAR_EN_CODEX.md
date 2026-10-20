# Talón v26: punto de continuación para Codex

## Pedido del usuario
Aplicar el estilo de la referencia aprobada: menú azul noche, acciones azul vivo, superficies claras, tipografía sans serif y tablas compactas. Conservar el funcionamiento de la v26. El trabajo se pausó por pedido del usuario para continuar en Codex.

## Estado del código
Rediseño ya aplicado en ocho archivos de presentación. Esta copia contiene ese avance; no es una versión aprobada para producción. El ZIP original talon_v26.zip y su reporte de bugs son la referencia funcional.

Archivos modificados:
- src/app/globals.css
- src/app/layout.tsx
- src/components/virtual-table.tsx
- src/components/ingreso/ingreso-screen.tsx
- src/components/shell/panel-shell.tsx
- src/components/tablero/tablero-screen.tsx
- src/components/ui/button.tsx
- src/components/ui/input.tsx

Los 95 archivos protegidos comparados (src/lib, src/server, API, migraciones, scripts, package.json, package-lock.json, public/sw.js y next.config.ts) coinciden byte por byte con el ZIP original. Se conservaron también los callbacks de eventos de los componentes compartidos y las instrucciones de login. La tabla virtual mantiene rowHeight=46.

El tablero presenta los mismos saldos, comprobantes y artículos bajo mínimo con tablas. Conserva los importes, sus signos, las leyendas de saldo a favor/deuda y los enlaces por tipo de comprobante. Se agregó un acceso a /ventas/nueva que respeta el permiso ventas.crear. No se inventaron métricas ni datos de actividad para imitar la imagen de referencia.

## Comprobaciones completadas
- npm run build: correcto, incluida la revisión TypeScript.
- npm test: 76 pasan; 2 omitidas por requerir PostgreSQL. Mismo resultado antes y después del rediseño.
- Lint: mismos 18 errores y 13 avisos que en la v26 original. No se cambiaron las reglas ni se corrigieron esos problemas fuera del alcance.
- Navegador real con respuestas de API simuladas: login, navegación, datos del tablero, enlaces a venta/compra, signos negativos y anulados, búsqueda de ventas, formulario de cliente y payload de guardado, menú móvil y desplazamiento horizontal de tablas.
- Vistas de 1440, 390 y 320 px: sin desbordamiento horizontal de la página ni errores de JavaScript en los recorridos probados.
- Sin solicitudes a /api/estacion en la empresa comercial de prueba.

## Pendiente antes de considerar el trabajo terminado
1. Revisar el resultado visual con el usuario en Codex y ajustar lo que indique.
2. Conectar una base PostgreSQL de demostración y probar ventas, stock, caja y permisos con datos persistentes. Las pruebas con API simulada no sustituyen esa verificación.
3. Ejecutar las 2 pruebas de integración de base de datos.
4. Repetir la verificación offline de producción del reporte de bugs original: aviso sin conexión, vale offline, F5 sin red y sincronización posterior. La lógica y el service worker no se modificaron, pero ese recorrido completo no se verificó aquí.
5. Verificar impresión de comprobantes y CAE/QR cuando corresponda; no hubo prueba contra ARCA.

## Cómo continuar
Abrir la carpeta talon en Codex y leer AGENTS.md. Instalar dependencias con npm install y usar el .env.local del usuario o uno de una base de demostración. Este paquete no incluye claves, node_modules ni .next. Mantiene las versiones de dependencias del ZIP recibido.

El comando original npm run local:prod compila, regenera public/shell-assets.json y arranca en el puerto 4318; usar producción para probar offline. No modificar a mano el service worker ni saltear permisos para hacer pruebas visuales.

## Instrucción para Codex
Continuá desde esta copia del rediseño de Talón v26. Primero leé CONTINUAR_EN_CODEX.md y docs/reporte-bugs-v26.md. Conservá la lógica y los archivos protegidos originales; concentrá los ajustes en presentación. Terminá las verificaciones pendientes antes de afirmar que está listo para producción. No desplegar ni usar una base real sin indicación del usuario.
