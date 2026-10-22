# Talón – arreglos módulo Impuestos (etapa 1) + modo estudio

## 1. Error de CUIT y validaciones del import → 4xx legibles
- `src/lib/impuestos/mis-comprobantes.ts`: `ImportValidationError` (422). Mensaje: «El CUIT del archivo (X) no coincide con el de la empresa (Y)». También cubre el título no reconocido y la columna faltante.
- `src/lib/impuestos/importar.ts`: los permisos que faltan devuelven 403.
- `src/server/impuestos.ts`: convierte `ImportValidationError` en `HttpError`.

## 2. Borrar comprobantes importados
- `drizzle/0034_impuestos_fk_import_rows.sql`: la FK compuesta pasa a `ON DELETE SET NULL (comprobante_id)` (PG15+, Talón trae PG16). Ya no se anula company_id.

## 3. Carrera en el Libro IVA
- `src/components/impuestos/libro-screen.tsx`: efecto con bandera `stale`, así se descartan las respuestas de un período o libro anterior. Valida un período de 6 dígitos y muestra los errores.

## 4. Impuestos sólo para Contador (también en el servidor)
- `permissions.ts`: `ROLE_EXCLUSIVE_MODULES={impuestos:"contador"}` y `permissionAllowedForRole`. La plantilla de Administración ya no trae impuestos.* y la de Contador los trae todos.
- `session.ts`: filtra los permisos por puesto. Eso cubre el menú, `requirePermission` y la API.
- `dispatch.ts` (PATCH de puestos): devuelve 400 si se intenta dar impuestos.* a un puesto que no es Contador.
- `drizzle/0035_impuestos_solo_contador.sql`: limpia los permisos existentes, completa los de Contador y agrega un trigger en role_permissions (42501).
- `domain/company.ts`: el alta usa la plantilla de Administración.
- Decisiones: Administración pierde Impuestos y Contador pasa a tener Impuestos completo. A un puesto personalizado no se le puede dar Impuestos. Un puesto de sistema editado conserva su key.

## 5. Modo estudio
- `drizzle/0036_companies_tipo.sql`: `companies.tipo` ('negocio' por defecto | 'estudio'). Las empresas existentes no cambian.
- Alta de empresa (`company-create-form.tsx`, `/alta-empresa`): pregunta «¿Negocio o Estudio contable?». Estudio → enabled_modules = ['impuestos'] (lo fuerza el servidor) y Sueldos aparece como «próximamente», sin habilitar (`ESTUDIO_FUTURE_MODULES`). Quien crea el estudio queda como Contador, con configuracion.ver/editar.
- El menú y las rutas ya se bloquean por enabled_modules (`requirePermission` → `moduleEnabled`). Tablero y Configuración siguen siempre disponibles.
- Hook para el instalador (no interactivo, idempotente, necesita DATABASE_URL_ADMIN):
  - `npm run talon:modo -- estudio --empresa todas` (o `--empresa <id|slug>`; `negocio` para volver)
  - `TALON_MODO=estudio npm run talon:modo` (sin argumento toma la variable; empresa por defecto = todas)
  - `TALON_MODO=estudio npm run db:seed` lo aplica al final del seed.
  - Con TALON_MODO definido en el entorno del servidor, el alta llega con esa opción preseleccionada y la usa por defecto si la API no recibe `tipo`.
  - Estudio: tipo='estudio', enabled_modules=['impuestos']. Los miembros de Administración pasan a Contador y Contador recibe configuracion.ver/editar. Se escribe un registro en audit_log ('configuracion.modo'). No se borran datos.
  - Negocio: si la empresa estaba en estudio, vuelven los módulos de su rubro. Si ya era negocio, no se tocan. Los puestos no vuelven a cambiar.
  - Código de salida: 0 si aplicó o no había nada que cambiar; 1 si hubo un error, por ejemplo una empresa inexistente.
- El kit incluye `ELEGIR-MODO-TALON.cmd` y `herramientas/talon.ps1`: pregunta Negocio o Estudio antes de llamar a `PROBAR-TALON.cmd`. Para automatizar acepta `TALON_MODO=negocio|estudio`.
- Sueldos está registrado en Configuración como **Próximamente**. No genera permisos, no se puede activar y no expone rutas.

## 6. Prender y apagar módulos en Configuración
- Ya existía (PATCH /api/configuracion, requiere configuracion.editar). Ahora audit_log guarda qué módulos se activaron o desactivaron (`moduleToggleDelta`). Sólo cambia enabled_modules y nunca borra datos (está aclarado en la pantalla).

## Tests
- Nuevos o actualizados: company-mode.test.ts, permissions/access tests, mis-comprobantes.test.ts, impuestos-rls.integration (FK, trigger, talon:modo) y business-flows (alta en modo estudio → Contador, ['impuestos'], /clientes 403).

Resultados obtenidos el 22/10/2026 con Node.js 24.19.0, npm 11.9.0 y PostgreSQL 16.15:
- TypeScript (`npx tsc --noEmit`): correcto.
- Lint: 0 errores y 4 advertencias preexistentes (virtualización y navegación de sesión).
- Unitarias y base limpia (`npm test`): 119 aprobadas, 23 omitidas por pertenecer a las suites de integración.
- PostgreSQL/RLS (`RUN_DB_TESTS=1 npm run test:db`): 9 aprobadas.
- Flujos de producción (`npm run test:flows`): build correcto y 14 aprobadas.
- Migración de actualización: esquema hasta 0033 → 0034/0035/0036, correcta; verificadas las tres migraciones y el valor predeterminado `companies.tipo='negocio'`.
- Migración y seed sobre base vacía: correctos, cubiertos por `seed.integration.test.ts`.

## Verificación en Windows
- Instrucciones en `docs/modo-estudio-windows.md`.
- La ejecución de PowerShell y `.cmd` queda marcada como **NO VERIFICADO** hasta probarla en una PC o VM Windows.
