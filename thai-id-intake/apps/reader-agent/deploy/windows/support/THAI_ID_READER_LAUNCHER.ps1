$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$supportDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleDir = Split-Path -Parent $supportDir
$envFile = Join-Path $supportDir "reader.env"
$entrypoint = Join-Path $bundleDir "app/index.js"
$runnerScript = Join-Path $supportDir "RUN_READER_AGENT_BACKGROUND.ps1"
$stopScript = Join-Path $supportDir "STOP_READER_AGENT.ps1"
$pidFile = Join-Path $supportDir ".reader-agent.pid"
$logDir = Join-Path $supportDir "logs"
$logFile = Join-Path $logDir "reader-agent.log"
$bundledNode = Join-Path $bundleDir "runtime/node/node.exe"
$rootNode = Join-Path $bundleDir "node.exe"
$safeTextPattern = "^[A-Za-z0-9._-]{1,80}$"

function Read-EnvFile {
  $values = @{}
  if (-not (Test-Path -LiteralPath $envFile)) {
    return $values
  }

  Get-Content -LiteralPath $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Count -eq 2) {
      $values[$parts[0].Trim()] = $parts[1].Trim()
    }
  }
  return $values
}

function Get-EnvOrDefault {
  param(
    [hashtable] $Values,
    [string] $Name,
    [string] $Default
  )

  if ($Values.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string] $Values[$Name])) {
    return [string] $Values[$Name]
  }

  return $Default
}

function Resolve-InitialConfig {
  $envValues = Read-EnvFile
  $broker = Get-EnvOrDefault -Values $envValues -Name "KAFKA_BROKERS" -Default "SERVER_IP:9092"
  $firstBroker = $broker.Split(",")[0].Trim()
  $serverIp = "SERVER_IP"
  $kafkaPort = "9092"

  if ($firstBroker.Contains(":")) {
    $parts = $firstBroker.Split(":")
    $kafkaPort = $parts[-1]
    $serverIp = ($parts[0..($parts.Count - 2)] -join ":")
  }

  return [pscustomobject]@{
    ServerIp = $serverIp
    KafkaPort = $kafkaPort
    StationId = Get-EnvOrDefault -Values $envValues -Name "STATION_ID" -Default "A01"
    ReaderId = Get-EnvOrDefault -Values $envValues -Name "READER_ID" -Default "A01-PC-01"
    ReaderHeartbeatMs = Get-EnvOrDefault -Values $envValues -Name "READER_HEARTBEAT_MS" -Default "10000"
    InsertCardDelayMs = Get-EnvOrDefault -Values $envValues -Name "INSERT_CARD_DELAY_MS" -Default "500"
    ReadTimeoutMs = Get-EnvOrDefault -Values $envValues -Name "READ_TIMEOUT_MS" -Default "5000"
  }
}

function Test-IPv4 {
  param([string] $Value)

  $parts = $Value.Trim().Split(".")
  if ($parts.Count -ne 4) {
    return $false
  }

  foreach ($part in $parts) {
    $number = 0
    if (-not [int]::TryParse($part, [ref] $number)) {
      return $false
    }
    if ($number -lt 0 -or $number -gt 255) {
      return $false
    }
  }

  return $true
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

function Invoke-NodeCheck {
  param([string] $NodeExe)

  Push-Location $bundleDir
  try {
    $output = & $NodeExe -p "process.platform + ' ' + process.arch + ' node ' + process.version + ' abi ' + process.versions.modules" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Node.js failed to run. $($output -join ' ')"
    }
    return ($output -join "`r`n")
  } finally {
    Pop-Location
  }
}

function Test-PcscliteNativeAddon {
  param([string] $NodeExe)

  Push-Location $bundleDir
  try {
    $output = & $NodeExe -e "require('pcsclite'); console.log('pcsclite native module loaded')" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Windows cannot load the pcsclite native module. Repackage reader-agent with node_modules built for this Node runtime. $($output -join ' ')"
    }
    return ($output -join "`r`n")
  } finally {
    Pop-Location
  }
}

function Assert-ValidConfig {
  param(
    [string] $ServerIp,
    [string] $KafkaPort,
    [string] $StationId,
    [string] $ReaderId
  )

  if (-not (Test-IPv4 $ServerIp)) {
    throw "Enter a valid server IPv4 address, for example 192.168.1.50."
  }

  $port = 0
  if (-not [int]::TryParse($KafkaPort, [ref] $port) -or $port -lt 1 -or $port -gt 65535) {
    throw "Enter a valid Kafka port from 1 to 65535."
  }

  if ($StationId.Trim() -notmatch $safeTextPattern) {
    throw "Station ID may contain only letters, numbers, dot, underscore, and dash."
  }

  if ($ReaderId.Trim() -notmatch $safeTextPattern) {
    throw "Reader ID may contain only letters, numbers, dot, underscore, and dash."
  }
}

function Write-ReaderEnv {
  param(
    [string] $ServerIp,
    [string] $KafkaPort,
    [string] $StationId,
    [string] $ReaderId,
    [string] $ReaderHeartbeatMs,
    [string] $InsertCardDelayMs,
    [string] $ReadTimeoutMs
  )

  $content = @(
    "# Reader PC startup config."
    "# Generated by Thai ID Reader launcher."
    "KAFKA_BROKERS=$ServerIp`:$KafkaPort"
    ""
    "STATION_ID=$StationId"
    "READER_ID=$ReaderId"
    ""
    "READER_HEARTBEAT_MS=$ReaderHeartbeatMs"
    "INSERT_CARD_DELAY_MS=$InsertCardDelayMs"
    "READ_TIMEOUT_MS=$ReadTimeoutMs"
    "ENABLE_DEMO_COMMANDS=false"
    ""
  )
  Set-Content -LiteralPath $envFile -Value $content -Encoding ASCII
}

function Get-ReaderProcess {
  if (-not (Test-Path -LiteralPath $pidFile)) {
    return $null
  }

  $pidText = (Get-Content -LiteralPath $pidFile -TotalCount 1).Trim()
  $readerPid = 0
  if (-not [int]::TryParse($pidText, [ref] $readerPid)) {
    return $null
  }

  return Get-Process -Id $readerPid -ErrorAction SilentlyContinue
}

function Stop-ExistingReader {
  if (Test-Path -LiteralPath $stopScript) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null
  }
}

function Set-Status {
  param(
    [string] $Message,
    [System.Drawing.Color] $Color = [System.Drawing.Color]::FromArgb(55, 65, 81)
  )
  $statusLabel.ForeColor = $Color
  $statusLabel.Text = $Message
}

function Append-TerminalLine {
  param([string] $Message)
  $terminalBox.AppendText($Message + [Environment]::NewLine)
}

function Refresh-TerminalFromLog {
  if (-not (Test-Path -LiteralPath $logFile)) {
    return
  }

  try {
    $text = Get-Content -LiteralPath $logFile -Raw -ErrorAction Stop
    if ($text.Length -gt 120000) {
      $text = $text.Substring($text.Length - 120000)
    }
    if ($terminalBox.Text -ne $text) {
      $terminalBox.Text = $text
      $terminalBox.SelectionStart = $terminalBox.TextLength
      $terminalBox.ScrollToCaret()
    }
  } catch {
    # The runner may be writing while the GUI tails. Try again on the next timer tick.
  }
}

function Start-ReaderAgent {
  param(
    [string] $ServerIp,
    [string] $KafkaPort,
    [string] $StationId,
    [string] $ReaderId,
    [string] $ReaderHeartbeatMs,
    [string] $InsertCardDelayMs,
    [string] $ReadTimeoutMs
  )

  Assert-ValidConfig -ServerIp $ServerIp -KafkaPort $KafkaPort -StationId $StationId -ReaderId $ReaderId

  if (-not (Test-Path -LiteralPath $entrypoint)) {
    throw "Reader-agent entrypoint not found: $entrypoint"
  }

  if (Get-ReaderProcess) {
    Stop-ExistingReader
    Start-Sleep -Milliseconds 500
  }

  Write-ReaderEnv `
    -ServerIp $ServerIp `
    -KafkaPort $KafkaPort `
    -StationId $StationId `
    -ReaderId $ReaderId `
    -ReaderHeartbeatMs $ReaderHeartbeatMs `
    -InsertCardDelayMs $InsertCardDelayMs `
    -ReadTimeoutMs $ReadTimeoutMs

  New-Item -ItemType Directory -Path $logDir -Force | Out-Null

  $nodeExe = Resolve-NodeExe
  $nodeInfo = Invoke-NodeCheck -NodeExe $nodeExe
  $pcscliteInfo = Test-PcscliteNativeAddon -NodeExe $nodeExe

  Set-Status "Checking Kafka reachability..."
  $canReachKafka = Test-NetConnection -ComputerName $ServerIp -Port ([int] $KafkaPort) -InformationLevel Quiet
  if (-not $canReachKafka) {
    throw "Cannot reach Kafka at $ServerIp`:$KafkaPort. Check network, server startup, or firewall."
  }

  Set-Content -LiteralPath $logFile -Value @(
    "Preflight passed."
    "Node: $nodeInfo"
    "Native module: $pcscliteInfo"
    "Kafka reachable: $ServerIp`:$KafkaPort"
    ""
  ) -Encoding UTF8

  $runnerArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runnerScript`""
  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList $runnerArguments `
    -WorkingDirectory $bundleDir `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

  Start-Sleep -Seconds 2
  $running = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if (-not $running) {
    $logTail = ""
    if (Test-Path -LiteralPath $logFile) {
      $logTail = (Get-Content -LiteralPath $logFile -Tail 20) -join "`r`n"
    }
    throw "Reader-agent did not stay running. $logTail"
  }
}

$initial = Resolve-InitialConfig

$form = New-Object System.Windows.Forms.Form
$form.Text = "Thai ID Reader"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(680, 620)
$form.MinimumSize = New-Object System.Drawing.Size(680, 500)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = "Thai ID Reader Setup"
$titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$titleLabel.Location = New-Object System.Drawing.Point(24, 20)
$titleLabel.Size = New-Object System.Drawing.Size(420, 34)
$form.Controls.Add($titleLabel)

$subtitleLabel = New-Object System.Windows.Forms.Label
$subtitleLabel.Text = "Enter the server details, then start the local card reader."
$subtitleLabel.Location = New-Object System.Drawing.Point(26, 58)
$subtitleLabel.Size = New-Object System.Drawing.Size(560, 24)
$form.Controls.Add($subtitleLabel)

function Add-Field {
  param(
    [string] $Label,
    [string] $Text,
    [int] $Y
  )

  $labelControl = New-Object System.Windows.Forms.Label
  $labelControl.Text = $Label
  $labelControl.Location = New-Object System.Drawing.Point(28, $Y)
  $labelControl.Size = New-Object System.Drawing.Size(130, 28)
  $form.Controls.Add($labelControl)

  $textBox = New-Object System.Windows.Forms.TextBox
  $textBox.Text = $Text
  $textBox.Location = New-Object System.Drawing.Point(165, ($Y - 2))
  $textBox.Size = New-Object System.Drawing.Size(260, 28)
  $form.Controls.Add($textBox)

  return $textBox
}

$serverIpBox = Add-Field -Label "Server IP" -Text $initial.ServerIp -Y 105
$kafkaPortBox = Add-Field -Label "Kafka Port" -Text $initial.KafkaPort -Y 145
$stationIdBox = Add-Field -Label "Station ID" -Text $initial.StationId -Y 185
$readerIdBox = Add-Field -Label "Reader ID" -Text $initial.ReaderId -Y 225

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Ready."
$statusLabel.Location = New-Object System.Drawing.Point(28, 272)
$statusLabel.Size = New-Object System.Drawing.Size(600, 52)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(55, 65, 81)
$form.Controls.Add($statusLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "Start Reader"
$startButton.Location = New-Object System.Drawing.Point(28, 330)
$startButton.Size = New-Object System.Drawing.Size(130, 36)
$form.Controls.Add($startButton)

$testButton = New-Object System.Windows.Forms.Button
$testButton.Text = "Test"
$testButton.Location = New-Object System.Drawing.Point(170, 330)
$testButton.Size = New-Object System.Drawing.Size(100, 36)
$form.Controls.Add($testButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = "Stop"
$stopButton.Location = New-Object System.Drawing.Point(282, 330)
$stopButton.Size = New-Object System.Drawing.Size(100, 36)
$form.Controls.Add($stopButton)

$closeNowButton = New-Object System.Windows.Forms.Button
$closeNowButton.Text = "Close Now"
$closeNowButton.Location = New-Object System.Drawing.Point(394, 330)
$closeNowButton.Size = New-Object System.Drawing.Size(110, 36)
$closeNowButton.Visible = $false
$form.Controls.Add($closeNowButton)

$keepOpenButton = New-Object System.Windows.Forms.Button
$keepOpenButton.Text = "Keep Open"
$keepOpenButton.Location = New-Object System.Drawing.Point(516, 330)
$keepOpenButton.Size = New-Object System.Drawing.Size(110, 36)
$keepOpenButton.Visible = $false
$form.Controls.Add($keepOpenButton)

$terminalBox = New-Object System.Windows.Forms.TextBox
$terminalBox.Location = New-Object System.Drawing.Point(28, 388)
$terminalBox.Size = New-Object System.Drawing.Size(600, 160)
$terminalBox.Multiline = $true
$terminalBox.ScrollBars = "Vertical"
$terminalBox.ReadOnly = $true
$terminalBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$terminalBox.Visible = $false
$form.Controls.Add($terminalBox)

$autoCloseSeconds = 8
$autoCloseTimer = New-Object System.Windows.Forms.Timer
$autoCloseTimer.Interval = 1000
$autoCloseTimer.Add_Tick({
  $script:autoCloseSeconds -= 1
  if ($script:autoCloseSeconds -le 0) {
    $autoCloseTimer.Stop()
    $form.Close()
    return
  }
  Set-Status "Reader running. Closing in $script:autoCloseSeconds seconds..." ([System.Drawing.Color]::FromArgb(22, 101, 52))
})

$tailTimer = New-Object System.Windows.Forms.Timer
$tailTimer.Interval = 1000
$tailTimer.Add_Tick({ Refresh-TerminalFromLog })

$startButton.Add_Click({
  $startButton.Enabled = $false
  $testButton.Enabled = $false
  try {
    Set-Status "Validating reader setup..."
    Start-ReaderAgent `
      -ServerIp $serverIpBox.Text.Trim() `
      -KafkaPort $kafkaPortBox.Text.Trim() `
      -StationId $stationIdBox.Text.Trim() `
      -ReaderId $readerIdBox.Text.Trim() `
      -ReaderHeartbeatMs $initial.ReaderHeartbeatMs `
      -InsertCardDelayMs $initial.InsertCardDelayMs `
      -ReadTimeoutMs $initial.ReadTimeoutMs

    $script:autoCloseSeconds = 8
    Set-Status "Reader running. Closing in 8 seconds..." ([System.Drawing.Color]::FromArgb(22, 101, 52))
    $closeNowButton.Visible = $true
    $keepOpenButton.Visible = $true
    $autoCloseTimer.Start()
  } catch {
    Set-Status $_.Exception.Message ([System.Drawing.Color]::FromArgb(185, 28, 28))
  } finally {
    $startButton.Enabled = $true
    $testButton.Enabled = $true
  }
})

$testButton.Add_Click({
  try {
    Set-Status "Testing reader setup..."
    Assert-ValidConfig `
      -ServerIp $serverIpBox.Text.Trim() `
      -KafkaPort $kafkaPortBox.Text.Trim() `
      -StationId $stationIdBox.Text.Trim() `
      -ReaderId $readerIdBox.Text.Trim()
    $nodeExe = Resolve-NodeExe
    $nodeInfo = Invoke-NodeCheck -NodeExe $nodeExe
    $pcscliteInfo = Test-PcscliteNativeAddon -NodeExe $nodeExe
    $canReachKafka = Test-NetConnection -ComputerName $serverIpBox.Text.Trim() -Port ([int] $kafkaPortBox.Text.Trim()) -InformationLevel Quiet
    if (-not $canReachKafka) {
      throw "Cannot reach Kafka at $($serverIpBox.Text.Trim()):$($kafkaPortBox.Text.Trim())."
    }
    Set-Status "Preflight passed. $nodeInfo. $pcscliteInfo." ([System.Drawing.Color]::FromArgb(22, 101, 52))
  } catch {
    Set-Status $_.Exception.Message ([System.Drawing.Color]::FromArgb(185, 28, 28))
  }
})

$stopButton.Add_Click({
  try {
    Stop-ExistingReader
    $autoCloseTimer.Stop()
    Set-Status "Reader-agent stopped."
  } catch {
    Set-Status $_.Exception.Message ([System.Drawing.Color]::FromArgb(185, 28, 28))
  }
})

$closeNowButton.Add_Click({
  $autoCloseTimer.Stop()
  $form.Close()
})

$keepOpenButton.Add_Click({
  $autoCloseTimer.Stop()
  $terminalBox.Visible = $true
  $form.Height = 660
  Refresh-TerminalFromLog
  $tailTimer.Start()
  Set-Status "Reader running. Live output is shown below." ([System.Drawing.Color]::FromArgb(22, 101, 52))
})

$form.Add_Shown({
  if (Get-ReaderProcess) {
    Set-Status "Reader-agent is already running." ([System.Drawing.Color]::FromArgb(22, 101, 52))
    $keepOpenButton.Visible = $true
    $closeNowButton.Visible = $true
  }
})

$form.Add_FormClosing({
  $autoCloseTimer.Stop()
  $tailTimer.Stop()
})

[void] $form.ShowDialog()
