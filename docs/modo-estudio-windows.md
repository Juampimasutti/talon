# Modo Negocio y Estudio en Windows

Hay un solo kit de instalación (`PROBAR-TALON.cmd`) y no pregunta nada. Al iniciar, Talón oculta Impuestos del menú (y lo bloquea en la API) en las empresas de tipo negocio cuyo rubro es `comercio` (incluye distribuidoras) o `estacion` (estación de servicio). Las empresas en modo estudio siempre tienen Impuestos.

Opcionalmente, para forzar un modo sin preguntas:

```powershell
$env:TALON_MODO = 'estudio'
.\PROBAR-TALON.cmd
```

Para cambiar empresas ya creadas desde la carpeta del proyecto:

```powershell
npm run talon:modo -- estudio
npm run talon:modo -- negocio
```

El cambio conserva los datos. En modo Estudio queda habilitado Impuestos; Sueldos se muestra como **Próximamente** y no se puede activar. Cada cambio de módulos queda registrado en la auditoría.

## Prueba pendiente en Windows

La ejecución real de los archivos `.cmd` y PowerShell debe verificarse en una PC o VM Windows con Node.js 24 LTS, npm 11 y Docker Desktop. Comprobar la instalación sin variables, una ejecución con `TALON_MODO=estudio`, la repetición idempotente de `talon:modo` y la conservación de datos al alternar modos.
