# One script to start My Office on Windows, with the saved OMP sessions, and open it in the browser.
#   .\start-office.ps1              start (builds the web app first if needed) and open the browser
#   .\start-office.ps1 rebuild      rebuild the web app first, then start (use after pulling or changing code)
#   .\start-office.ps1 nobrowser    start without opening the browser
#   .\start-office.ps1 buildonly    rebuild the web app only without starting the server
# Stop it by closing this window or pressing Ctrl+C.

$ErrorActionPreference = 'Stop'
try { $Host.UI.RawUI.WindowTitle = 'My Office' } catch {}
Set-Location -LiteralPath $PSScriptRoot

$env:OFFICE_PORT = '4310'
$env:OFFICE_DIST_DIR = '.next-win-p3'
$env:NEXT_TELEMETRY_DISABLED = '1'
$url = "http://127.0.0.1:$($env:OFFICE_PORT)"

$rebuild = $false
$openBrowser = $true
$buildOnly = $false

foreach ($arg in $args) {
  switch ($arg.ToString().TrimStart('-').ToLowerInvariant()) {
    'rebuild'   { $rebuild = $true }
    'nobrowser' { $openBrowser = $false }
    'buildonly' { $rebuild = $true; $buildOnly = $true; $openBrowser = $false }
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js was not found. Install Node.js and run this again.' -ForegroundColor Red
  if ([Environment]::UserInteractive -and -not $buildOnly) { Read-Host 'Press Enter to exit' | Out-Null }
  exit 1
}

$nextBin = Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $nextBin)) {
  Write-Host 'The packages are not installed. Run npm install in this folder first.' -ForegroundColor Red
  if ([Environment]::UserInteractive -and -not $buildOnly) { Read-Host 'Press Enter to exit' | Out-Null }
  exit 1
}

# Saved OMP sessions: only when the config exists. Otherwise the office starts without them.
$ompConfig = Join-Path $PSScriptRoot 'data\omp-config.json'
if (Test-Path -LiteralPath $ompConfig) {
  $env:OFFICE_OMP = 'hybrid'
  $env:OFFICE_OMP_CONFIG = $ompConfig
} else {
  Write-Host 'Note: data\omp-config.json was not found, so OMP history is off.'
}

# OMP Multi-Account Usage (openai-codex & google-antigravity): on by default (set OFFICE_OMP_USAGE=0 to disable).
if (-not $env:OFFICE_OMP_USAGE) {
  $env:OFFICE_OMP_USAGE = '1'
}

if (-not $buildOnly) {
  # Never start a second copy: if the port is taken the office is most likely already running.
  $listening = Get-NetTCPConnection -LocalPort ([int]$env:OFFICE_PORT) -State Listen -ErrorAction SilentlyContinue
  if ($listening) {
    Write-Host "Port $($env:OFFICE_PORT) is already in use, the office is probably running at $url"
    if ($openBrowser) { Start-Process $url }
    exit 0
  }
}

$buildIdFile = Join-Path $PSScriptRoot "$($env:OFFICE_DIST_DIR)\BUILD_ID"
if ($rebuild -or -not (Test-Path -LiteralPath $buildIdFile)) {
  Write-Host 'Building the web app, this can take a few minutes...'
  $tsconfigPath = Join-Path $PSScriptRoot 'tsconfig.json'
  $tsconfigBackup = if (Test-Path -LiteralPath $tsconfigPath) { [System.IO.File]::ReadAllBytes($tsconfigPath) } else { $null }
  try {
    & node $nextBin build
    $buildExit = $LASTEXITCODE
  } finally {
    # The build reformats tsconfig.json; restore the exact bytes so the working tree stays clean.
    if ($null -ne $tsconfigBackup) {
      [System.IO.File]::WriteAllBytes($tsconfigPath, $tsconfigBackup)
    }
  }
  if ($buildExit -ne 0) {
    Write-Host 'The build failed, see the messages above.' -ForegroundColor Red
    if ([Environment]::UserInteractive -and -not $buildOnly) { Read-Host 'Press Enter to exit' | Out-Null }
    exit 1
  }
}

if ($buildOnly) {
  exit 0
}

if ($openBrowser) {
  $waitCmd = "for(`$i=0;`$i -lt 60;`$i++){try{Invoke-WebRequest -UseBasicParsing -Uri '$url/api/doctor' -TimeoutSec 2 | Out-Null; Start-Process '$url'; break}catch{Start-Sleep -Milliseconds 500}}"
  Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-Command', $waitCmd -WindowStyle Hidden
}

Write-Host "My Office is starting at $url  (close this window or press Ctrl+C to stop)"
& node (Join-Path $PSScriptRoot 'server\index.mjs')
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'The office stopped with an error, see the messages above.' -ForegroundColor Red
  if ([Environment]::UserInteractive) { Read-Host 'Press Enter to exit' | Out-Null }
  exit $LASTEXITCODE
}
