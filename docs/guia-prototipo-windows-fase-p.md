# Talón — prototipo manual de Windows (Fase P)

Esta guía prueba el camino técnico sin Docker. No instala servicios, no crea un
`Setup.exe` y no debe usarse con datos reales. Usá una VM limpia y datos
ficticios.

## 1. Preparar el paquete

El standalone debe compilarse en Windows con Node.js 24 porque algunas
dependencias contienen binarios específicos del sistema operativo. Un paquete
creado en Linux no se considera un paquete de Windows.

En una copia limpia del repositorio, desde PowerShell:

```powershell
npm ci
npm run build:standalone
```

Si Next informa que no puede crear enlaces de directorio, activá el Modo para
desarrolladores de Windows o repetí el build con una terminal elevada y anotá
cuál alternativa fue necesaria. Los junctions de Windows pueden guardar rutas
absolutas, por eso hay que comprobar que el paquete siga funcionando después de
copiarlo a `C:\Talon\app`.

Copiá el contenido de `.next\standalone\` a `C:\Talon\app\`. La carpeta debe
contener `server.js`, `public\`, `.next\static\`, `drizzle\` y `scripts\`.
No copies `.env`, `.env.local`, `.git`, `node_modules` del repositorio ni datos
reales. El script de empaquetado elimina los `.env` conocidos del standalone.

Descomprimí la distribución ZIP oficial de Node.js 24 para Windows x64 en
`C:\Talon\node\`, y el ZIP de PostgreSQL 16 x64 en
`C:\Talon\postgres\`. Creá además:

```powershell
New-Item -ItemType Directory -Force C:\Talon\datos,C:\Talon\respaldos,C:\Talon\logs,C:\Talon\config | Out-Null
```

## 2. Inicializar PostgreSQL portable

Abrí una PowerShell normal, sin ejecutar como administrador. PostgreSQL no
permite que `initdb` se ejecute con privilegios administrativos.

```powershell
$adminPassword = [guid]::NewGuid().ToString("N")
$appPassword = [guid]::NewGuid().ToString("N")
Set-Content -NoNewline C:\Talon\config\pg-admin-password.txt $adminPassword
& C:\Talon\postgres\bin\initdb.exe -D C:\Talon\datos -U postgres -A scram-sha-256 --pwfile=C:\Talon\config\pg-admin-password.txt --encoding=UTF8
Remove-Item C:\Talon\config\pg-admin-password.txt
Add-Content C:\Talon\datos\postgresql.conf "`nport = 5433`nlisten_addresses = '127.0.0.1'"
& C:\Talon\postgres\bin\pg_ctl.exe -D C:\Talon\datos -l C:\Talon\logs\postgres.log -w start
```

Si aparece un error por DLL faltante, anotá el mensaje exacto: puede indicar
que falta Microsoft Visual C++ Runtime. No abras el puerto 5433 en el firewall.

Creá la base y el rol de aplicación:

```powershell
$env:PGPASSWORD = $adminPassword
& C:\Talon\postgres\bin\createdb.exe -h 127.0.0.1 -p 5433 -U postgres talon
& C:\Talon\postgres\bin\psql.exe -h 127.0.0.1 -p 5433 -U postgres -d talon -v ON_ERROR_STOP=1 -c "CREATE ROLE talon_app LOGIN PASSWORD '$appPassword' NOSUPERUSER NOBYPASSRLS;"
```

Para esta prueba, las contraseñas son cadenas hexadecimales generadas por
PowerShell y se pueden incluir sin codificación adicional en las URLs. Guardá
`C:\Talon\config\.env` así:

```powershell
@"
DATABASE_URL_ADMIN=postgresql://postgres:$adminPassword@127.0.0.1:5433/talon
DATABASE_URL=postgresql://talon_app:$appPassword@127.0.0.1:5433/talon
ARCA_MODE=mock
TALON_BACKUP_DIR=C:\Talon\respaldos
"@ | Set-Content C:\Talon\config\.env
icacls C:\Talon\config\.env /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
$env:TALON_ENV_FILE = "C:\Talon\config\.env"
Remove-Item Env:PGPASSWORD
```

## 3. Migrar y arrancar

Los scripts compilados funcionan con Node, sin `tsx`:

```powershell
Set-Location C:\Talon
$env:TALON_ENV_FILE = "C:\Talon\config\.env"
& C:\Talon\node\node.exe C:\Talon\app\scripts\migrate.js
$env:HOSTNAME = "0.0.0.0"
$env:PORT = "4318"
& C:\Talon\node\node.exe C:\Talon\app\scripts\run-standalone.mjs
```

En otra terminal podés ejecutar un respaldo y luego dejar el worker activo:

```powershell
$env:TALON_ENV_FILE = "C:\Talon\config\.env"
& C:\Talon\node\node.exe C:\Talon\app\scripts\backup-worker.js --once
& C:\Talon\node\node.exe C:\Talon\app\scripts\backup-worker.js
```

Abrí `http://localhost:4318`. Para entrar desde otra PC, habilitá TCP 4318
solo para la red privada y usá `http://IP-DE-LA-PC:4318`. La corrección de las
cookies para HTTP en LAN corresponde a la Fase 0; registrá el resultado real.

## 4. Prueba de doble cobro

Esta prueba altera datos. Ejecutala únicamente en esta base ficticia:

```powershell
$env:TALON_PRUEBA_CONFIRMAR = "DATOS_FICTICIOS"
$env:TALON_EMAIL = "USUARIO-DE-PRUEBA"
$env:TALON_PASSWORD = "CLAVE-DE-PRUEBA"
$env:DATABASE_URL_ADMIN = "postgresql://postgres:$adminPassword@127.0.0.1:5433/talon"
$env:TALON_PRUEBA_LOG_DIR = "C:\Talon\logs"
& C:\Talon\node\node.exe C:\Talon\app\scripts\prueba-doble-cobro.mjs http://127.0.0.1:4318 5 todas
```

Repetí desde otra PC contra `http://IP-DE-LA-PC:4318` sin definir
`DATABASE_URL_ADMIN`; el conteo principal se hace por API. Conservá los JSON de
`C:\Talon\logs`.

## 5. Apagado manual

Detené la app y el worker con `Ctrl+C`, y luego PostgreSQL:

```powershell
& C:\Talon\postgres\bin\pg_ctl.exe -D C:\Talon\datos -w stop
```

El arranque automático, el orden de servicios, los reintentos después de un
reinicio y el instalador pertenecen a fases posteriores.
