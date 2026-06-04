param(
  [string]$ServiceName = "sgp-vibration",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator."
  }
}

Assert-Admin

$RunScript = Join-Path $ProjectRoot "scripts\windows\run-server.ps1"
if (-not (Test-Path $RunScript)) {
  throw "Missing run script: $RunScript"
}

$pwsh = (Get-Command powershell.exe -ErrorAction Stop).Source
$binPath = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$RunScript`" -ProjectRoot `"$ProjectRoot`""

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service exists. Updating: $ServiceName"
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
  }
  sc.exe config $ServiceName binPath= $binPath start= auto | Out-Host
} else {
  Write-Host "Creating service: $ServiceName"
  sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "SGP Vibration Datacenter" | Out-Host
}

sc.exe failure $ServiceName reset= 60 actions= restart/5000/restart/5000/restart/5000 | Out-Host
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3
Get-Service -Name $ServiceName

Write-Host "Health check:"
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing -TimeoutSec 10 | Select-Object -ExpandProperty Content
} catch {
  Write-Warning "Health check failed. Check logs: $ProjectRoot\logs\sgp-vibration.service.log"
}
