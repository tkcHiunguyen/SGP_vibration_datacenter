param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
$ServerDir = Join-Path $ProjectRoot "server"
$LogDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Set-Location $ServerDir
$env:NODE_ENV = "production"

$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $pnpm) {
  $pnpm = (Get-Command pnpm -ErrorAction Stop).Source
}

& $pnpm start *>> (Join-Path $LogDir "sgp-vibration.service.log")
