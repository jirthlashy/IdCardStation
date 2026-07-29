$ErrorActionPreference = "Stop"

$supportDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleDir = Split-Path -Parent $supportDir
$envFile = Join-Path $supportDir "reader.env"
$entrypoint = Join-Path $bundleDir "app/index.js"
$logDir = Join-Path $supportDir "logs"
$logFile = Join-Path $logDir "reader-agent.log"
$pidFile = Join-Path $supportDir ".reader-agent.pid"
$bundledNode = Join-Path $bundleDir "runtime/node/node.exe"
$rootNode = Join-Path $bundleDir "node.exe"

function Write-LogLine {
  param([string] $Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Add-Content -LiteralPath $logFile -Value $line
  Write-Host $line
}

function Load-EnvFile {
  param([string] $Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing reader.env in .reader-support"
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) {
      return
    }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($key.Length -gt 0) {
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

function Resolve-NodeExe {
  if (Test-Path -LiteralPath $bundledNode) {
    return $bundledNode
  }
  if (Test-Path -LiteralPath $rootNode) {
    return $rootNode
  }
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) {
    return $systemNode.Source
  }
  throw "Node.js runtime was not found. This deployment should include runtime\node\node.exe."
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII
Set-Content -LiteralPath $logFile -Value "" -Encoding UTF8
Write-LogLine "Starting Thai ID reader-agent..."

try {
  Set-Location $bundleDir
  Load-EnvFile $envFile

  if (-not (Test-Path -LiteralPath $entrypoint)) {
    throw "Reader-agent entrypoint not found: $entrypoint"
  }

  $nodeExe = Resolve-NodeExe
  Write-LogLine "Node exe: $nodeExe"
  Write-LogLine "Runtime: $(& $nodeExe -p ""process.platform + ' ' + process.arch + ' node ' + process.version + ' abi ' + process.versions.modules"")"
  Write-LogLine "Kafka: $env:KAFKA_BROKERS"
  Write-LogLine "Station: $env:STATION_ID"
  Write-LogLine "Reader: $env:READER_ID"
  Write-LogLine ""

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $nodeExe $entrypoint 2>&1 | ForEach-Object {
      $line = [string] $_
      Add-Content -LiteralPath $logFile -Value $line
      Write-Host $line
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  Write-LogLine "reader-agent exited with code $exitCode"
  exit $exitCode
} catch {
  Write-LogLine "ERROR: $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
