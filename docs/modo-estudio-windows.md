# Modo Negocio y Estudio en Windows

Para una instalación nueva, ejecutar `ELEGIR-MODO-TALON.cmd`. La herramienta pregunta si Talón se instalará como **Negocio** o **Estudio contable** y pasa la elección a la instalación mediante `TALON_MODO`.

También se puede ejecutar sin preguntas:

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

La ejecución real de los archivos `.cmd` y PowerShell debe verificarse en una PC o VM Windows con Node.js 24 LTS, npm 11 y Docker Desktop. Comprobar ambas opciones, una ejecución con `TALON_MODO=estudio`, la repetición idempotente de `talon:modo` y la conservación de datos al alternar modos.
