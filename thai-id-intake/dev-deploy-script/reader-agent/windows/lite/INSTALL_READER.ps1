param(
  [switch] $Elevated
)

$ErrorActionPreference = "Stop"

$supportDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleDir = Split-Path -Parent $supportDir
$runtimeDir = Join-Path $bundleDir "runtime"
$nodeDir = Join-Path $runtimeDir "node"
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
$stateFile = Join-Path $supportDir ".runtime-state.json"
$packageLock = Join-Path $bundleDir "package-lock.json"
$expectedNodeVersion = "v26.4.0"
$expectedNodeAbi = "147"
$nodeZipName = "node-v26.4.0-win-x64.zip"
$nodeZipUrl = "https://nodejs.org/download/release/v26.4.0/$nodeZipName"
$expectedNodeZipSha256 = "5f87d038c6ec442aa46b9126f8ca170acbd2f3b9b9152ca798cf54596a31e214"

function Write-Stage {
  param(
    [string] $Number,
    [string] $Message
  )

  Write-Host ""
  Write-Host "[$Number/5] $Message" -ForegroundColor Cyan
}

function ConvertTo-CommandLineArgument {
  param([string] $Value)

  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-VisibleProcess {
  param(
    [string] $FilePath,
    [string[]] $Arguments,
    [string] $WorkingDirectory,
    [string] $Activity
  )

  $argumentLine = ($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $argumentLine `
    -WorkingDirectory $WorkingDirectory `
    -NoNewWindow `
    -PassThru
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $nextUpdateSeconds = 10

  while (-not $process.HasExited) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($stopwatch.Elapsed.TotalSeconds -ge $nextUpdateSeconds) {
      Write-Host "$Activity is still running ($([math]::Floor($stopwatch.Elapsed.TotalSeconds)) seconds elapsed). Please keep this window open."
      $nextUpdateSeconds += 10
    }
  }

  $stopwatch.Stop()
  if ($process.ExitCode -ne 0) {
    throw "$Activity failed (exit code $($process.ExitCode))."
  }
  Write-Host "$Activity completed in $([math]::Ceiling($stopwatch.Elapsed.TotalSeconds)) seconds."
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PackageLockHash {
  if (-not (Test-Path -LiteralPath $packageLock)) {
    throw "Missing lite reader package lock: $packageLock"
  }
  return (Get-FileHash -LiteralPath $packageLock -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-InstalledRuntime {
  if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $npmCli) -or -not (Test-Path -LiteralPath $stateFile)) {
    return $false
  }

  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($state.packageLockSha256 -ne (Get-PackageLockHash)) {
      return $false
    }
    $version = (& $nodeExe --version).Trim()
    $abi = (& $nodeExe -p "process.versions.modules").Trim()
    if ($version -ne $expectedNodeVersion -or $abi -ne $expectedNodeAbi) {
      return $false
    }
    & $nodeExe -e "require('pcsclite'); console.log('pcsclite native module loaded')" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      return $false
    }
    & $nodeExe --check (Join-Path $bundleDir "app\index.js") | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Invoke-WingetInstall {
  param(
    [string] $PackageId,
    [string] $Override = ""
  )

  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "Windows Package Manager (winget) is required to install $PackageId. Install Microsoft App Installer, then run Thai ID Reader.bat again."
  }

  $arguments = @(
    "install",
    "--id", $PackageId,
    "--exact",
    "--silent",
    "--disable-interactivity",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )
  if ($Override) {
    $arguments += @("--override", $Override)
  }

  Write-Host "Installing $PackageId. This can take several minutes..."
  & winget.exe @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "winget could not install $PackageId (exit code $LASTEXITCODE)."
  }
}

function Get-PythonExe {
  $command = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LocalAppData "Programs\Python\Python312\python.exe"),
    (Join-Path $env:ProgramFiles "Python312\python.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $null
}

function Test-BuildToolsInstalled {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswhere)) {
    return $false
  }
  $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return -not [string]::IsNullOrWhiteSpace(($installationPath -join "").Trim())
}

function Install-NodeRuntime {
  Write-Stage -Number "1" -Message "Preparing the private Node.js runtime"
  $cacheDir = Join-Path $supportDir ".download-cache"
  $zipPath = Join-Path $cacheDir $nodeZipName
  $extractDir = Join-Path $cacheDir "node-extract"
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

  if (-not (Test-Path -LiteralPath $zipPath) -or (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedNodeZipSha256) {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    Write-Host "Downloading Node.js $expectedNodeVersion. This may take a few minutes on a slow connection..."
    Invoke-WebRequest -Uri $nodeZipUrl -OutFile $zipPath
  } else {
    Write-Host "Using the previously downloaded Node.js archive."
  }

  Write-Host "Verifying the Node.js download checksum..."
  $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedNodeZipSha256) {
    throw "Node.js download checksum verification failed."
  }

  Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Extracting Node.js into this reader folder..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
  $extractedNodeDir = Join-Path $extractDir "node-v26.4.0-win-x64"
  if (-not (Test-Path -LiteralPath (Join-Path $extractedNodeDir "node.exe"))) {
    throw "The Node.js download did not contain node.exe."
  }

  Remove-Item -LiteralPath $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Move-Item -LiteralPath $extractedNodeDir -Destination $nodeDir
  Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Node.js runtime is ready."
}

function Ensure-BuildPrerequisites {
  Write-Stage -Number "2" -Message "Checking Python and Microsoft C++ Build Tools"
  if (-not (Get-PythonExe)) {
    Invoke-WingetInstall -PackageId "Python.Python.3.12"
  } else {
    Write-Host "Python is already installed."
  }
  if (-not (Test-BuildToolsInstalled)) {
    Invoke-WingetInstall `
      -PackageId "Microsoft.VisualStudio.2022.BuildTools" `
      -Override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  } else {
    Write-Host "Microsoft C++ Build Tools are already installed."
  }
  $pythonExe = Get-PythonExe
  if (-not $pythonExe -or -not (Test-BuildToolsInstalled)) {
    throw "Python or Microsoft C++ Build Tools are still unavailable after installation. Restart Windows, then run Thai ID Reader.bat again."
  }
  Write-Host "Build prerequisites are ready."
  return $pythonExe
}

function Install-ReaderDependencies {
  Write-Stage -Number "3" -Message "Downloading reader dependencies"
  Write-Host "npm may be quiet while it downloads packages. A status update appears every 10 seconds."
  Invoke-VisibleProcess `
    -FilePath $nodeExe `
    -Arguments @($npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--fund=false") `
    -WorkingDirectory $bundleDir `
    -Activity "Reader dependency installation"
}

function Build-Pcsclite {
  param([string] $PythonExe)

  $pcscliteDir = Join-Path $bundleDir "node_modules\pcsclite"
  $nodeGypCli = Join-Path $nodeDir "node_modules\npm\node_modules\node-gyp\bin\node-gyp.js"
  if (-not (Test-Path -LiteralPath $pcscliteDir) -or -not (Test-Path -LiteralPath $nodeGypCli)) {
    throw "The downloaded reader dependencies are incomplete; pcsclite or node-gyp is missing."
  }

  Write-Stage -Number "4" -Message "Compiling the smart-card reader module"
  Write-Host "This can take several minutes. Do not close this window."
  Invoke-VisibleProcess `
    -FilePath $nodeExe `
    -Arguments @($nodeGypCli, "configure", "--python=$PythonExe") `
    -WorkingDirectory $pcscliteDir `
    -Activity "pcsclite configuration"

  # Node 26 can add unsupported LLVM linker flags to the MSVC project.
  $projectFile = Join-Path $pcscliteDir "build\pcsclite.vcxproj"
  if (-not (Test-Path -LiteralPath $projectFile)) {
    throw "node-gyp did not generate the pcsclite Visual Studio project."
  }
  $project = Get-Content -LiteralPath $projectFile -Raw
  $project = $project.Replace("-flto=thin", "").Replace("/opt:lldltojobs=2", "")
  Set-Content -LiteralPath $projectFile -Value $project -Encoding UTF8

  Invoke-VisibleProcess `
    -FilePath $nodeExe `
    -Arguments @($nodeGypCli, "build") `
    -WorkingDirectory $pcscliteDir `
    -Activity "pcsclite compilation"
}

function Write-InstallState {
  $state = [ordered]@{
    nodeVersion = $expectedNodeVersion
    nodeAbi = $expectedNodeAbi
    packageLockSha256 = Get-PackageLockHash
    installedAt = (Get-Date).ToString("o")
  }
  $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

if (Test-InstalledRuntime) {
  exit 0
}

if (-not $Elevated -and -not (Test-IsAdministrator)) {
  Write-Host "Thai ID Reader needs administrator approval once to install Windows build prerequisites."
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Elevated")
  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

try {
  Install-NodeRuntime
  $pythonExe = Ensure-BuildPrerequisites
  Install-ReaderDependencies
  Build-Pcsclite -PythonExe $pythonExe
  Write-Stage -Number "5" -Message "Validating the installed reader runtime"
  if (-not (Test-InstalledRuntime)) {
    Write-InstallState
  }
  if (-not (Test-InstalledRuntime)) {
    throw "Reader runtime validation failed after installation."
  }
  Write-Host "Thai ID Reader installation complete. Opening setup..."
  exit 0
} catch {
  Write-Error "Thai ID Reader installation failed: $($_.Exception.Message)"
  Write-Host ""
  Read-Host "Installation failed. Press Enter to close this window"
  exit 1
}
