param(
  [string]$ServiceName = "sgp-vibration",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$HealthUrl = "http://127.0.0.1:8080/health",
  [switch]$SkipGitPull
)

$ErrorActionPreference = "Stop"

function Invoke-Step([string]$Name, [scriptblock]$Block) {
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  & $Block
}

$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $pnpm) {
  $pnpm = (Get-Command pnpm -ErrorAction Stop).Source
}

Set-Location $ProjectRoot

Invoke-Step "Stop service if running" {
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
    $service.WaitForStatus("Stopped", "00:00:20")
  }
}

if (-not $SkipGitPull) {
  Invoke-Step "git pull" {
    git pull --ff-only
  }
}

Invoke-Step "pnpm install" {
  & $pnpm install --frozen-lockfile --ignore-scripts
}

Invoke-Step "pnpm release:check" {
  & $pnpm release:check
}

Invoke-Step "db init" {
  $env:DB_AUTO_INIT = "true"
  $env:DB_FALLBACK_ON_UNAVAILABLE = "false"
  & $pnpm db:init
}

Invoke-Step "Start service" {
  Start-Service -Name $ServiceName
  Start-Sleep -Seconds 5
  Get-Service -Name $ServiceName
}

Invoke-Step "Health check" {
  $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 15
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "Health check failed: HTTP $($response.StatusCode)"
  }
  $response.Content
}

Write-Host "`nDeploy OK" -ForegroundColor Green
