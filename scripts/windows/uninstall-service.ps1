param(
  [string]$ServiceName = "sgp-vibration"
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run PowerShell as Administrator."
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
    $service.WaitForStatus("Stopped", "00:00:20")
  }
  sc.exe delete $ServiceName | Out-Host
  Write-Host "Deleted service: $ServiceName"
} else {
  Write-Host "Service not found: $ServiceName"
}
