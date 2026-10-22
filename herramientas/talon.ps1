$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

# Kit único: no se pregunta nada. Si TALON_MODO ya viene definido (negocio|estudio)
# se respeta en silencio como override opcional; si no, se instala normal.
if ($env:TALON_MODO -and ($env:TALON_MODO -notin @('negocio', 'estudio'))) {
  Write-Host "TALON_MODO='$($env:TALON_MODO)' no es válido; se ignora."
  Remove-Item Env:TALON_MODO
}
$probar = Join-Path $raiz 'PROBAR-TALON.cmd'
if (-not (Test-Path $probar)) { throw "No se encontró $probar" }
& $probar
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
