$ErrorActionPreference = "Stop"

$supportDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $supportDir ".reader-agent.pid"

function Stop-ProcessTree {
  param([int] $ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int] $child.ProcessId)
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host "Reader-agent is not running."
  exit 0
}

$pidText = (Get-Content -LiteralPath $pidFile -TotalCount 1).Trim()
$readerPid = 0
if (-not [int]::TryParse($pidText, [ref] $readerPid)) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Removed invalid reader-agent PID file."
  exit 0
}

$process = Get-Process -Id $readerPid -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Reader-agent was not running. Removed stale PID file."
  exit 0
}

Stop-ProcessTree -ProcessId $readerPid
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "Reader-agent stopped."
