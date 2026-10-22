$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

function Elegir-Modo {
  if ($env:TALON_MODO -in @('negocio', 'estudio')) { return $env:TALON_MODO }
  do {
    Write-Host ''
    Write-Host '¿Qué querés instalar?'
    Write-Host '  N - Negocio'
    Write-Host '  E - Estudio contable (solo Impuestos; Sueldos próximamente)'
    $respuesta = (Read-Host 'Elegí N o E').Trim().ToLowerInvariant()
  } until ($respuesta -in @('n', 'negocio', 'e', 'estudio'))
  if ($respuesta -in @('e', 'estudio')) { return 'estudio' }
  return 'negocio'
}

$env:TALON_MODO = Elegir-Modo
Write-Host "Talón se preparará en modo $($env:TALON_MODO)."
$probar = Join-Path $raiz 'PROBAR-TALON.cmd'
if (-not (Test-Path $probar)) { throw "No se encontró $probar" }
& $probar
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
