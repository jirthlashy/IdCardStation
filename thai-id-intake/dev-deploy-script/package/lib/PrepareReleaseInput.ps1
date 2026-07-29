Set-StrictMode -Version Latest

$script:ReleaseNodeVersion = "v26.4.0"
$script:ReleaseNodeAbi = "147"
$script:ReleaseNodeZipName = "node-v26.4.0-win-x64.zip"
$script:ReleaseNodeZipUrl = "https://nodejs.org/download/release/v26.4.0/node-v26.4.0-win-x64.zip"
$script:ReleaseNodeZipSha256 = "5f87d038c6ec442aa46b9126f8ca170acbd2f3b9b9152ca798cf54596a31e214"
$script:KafkaVersion = "4.3.1"
$script:KafkaName = "kafka_2.13-4.3.1"
$script:KafkaUrl = "https://archive.apache.org/dist/kafka/4.3.1/kafka_2.13-4.3.1.tgz"
$script:KafkaSha512Url = "https://archive.apache.org/dist/kafka/4.3.1/kafka_2.13-4.3.1.tgz.sha512"

function Invoke-RequiredProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,

    [string[]] $Arguments = @(),

    [string] $WorkingDirectory = (Get-Location).Path,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  Write-Host $Description
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Save-VerifiedDownload {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Uri,

    [Parameter(Mandatory = $true)]
    [string] $Destination,

    [string] $ExpectedSha256
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  if (-not (Test-Path -LiteralPath $Destination)) {
    Write-Host "Downloading $Uri"
    Invoke-WebRequest -Uri $Uri -OutFile $Destination
  }

  if ($ExpectedSha256) {
    $actual = Get-FileSha256 -Path $Destination
    if ($actual -ne $ExpectedSha256) {
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      throw "Checksum mismatch for $Destination. Expected $ExpectedSha256, found $actual."
    }
  }
}

function Save-VerifiedKafkaArchive {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ArchivePath,

    [Parameter(Mandatory = $true)]
    [string] $ChecksumPath
  )

  Save-VerifiedDownload -Uri $script:KafkaUrl -Destination $ArchivePath
  Save-VerifiedDownload -Uri $script:KafkaSha512Url -Destination $ChecksumPath

  $checksumText = Get-Content -Raw -LiteralPath $ChecksumPath
  $expected = ([regex]::Match($checksumText, "[A-Fa-f0-9]{128}")).Value.ToLowerInvariant()
  if (-not $expected) {
    throw "Could not parse Kafka SHA-512 checksum from $ChecksumPath."
  }

  $actual = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA512).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
    throw "Kafka archive checksum mismatch. Expected $expected, found $actual."
  }
}

function Expand-TarGz {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ArchivePath,

    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  $tar = Get-Command tar -ErrorAction SilentlyContinue
  if (-not $tar) {
    throw "tar is required to extract Kafka."
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Invoke-RequiredProcess -FilePath $tar.Source -Arguments @("-xzf", $ArchivePath, "-C", $Destination) -Description "Extracting Kafka archive"
}

function Copy-SharedTypesRuntimePackage {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  $sharedDist = Join-Path $Paths.WorkspaceRoot "packages\shared-types\dist"
  Assert-PathExists -Path (Join-Path $sharedDist "index.js") -Type File
  Assert-PathExists -Path (Join-Path $sharedDist "index.d.ts") -Type File

  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-DirectoryExact -Source $sharedDist -Destination (Join-Path $Destination "dist")
  Write-GeneratedText -Path (Join-Path $Destination "package.json") -Text @'
{
  "name": "@thai-id-intake/shared-types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
'@
}

function Copy-ThaiIdCardReaderVendor {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  $source = Join-Path $Paths.WorkspaceRoot "node_modules\thai-id-card-reader"
  Assert-PathExists -Path (Join-Path $source "build\index.js") -Type File

  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-DirectoryExact -Source (Join-Path $source "build") -Destination (Join-Path $Destination "build")
  Write-GeneratedText -Path (Join-Path $Destination "package.json") -Text @'
{
  "name": "thai-id-card-reader",
  "version": "1.0.54-lite-vendor",
  "private": true,
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "dependencies": {
    "axios": "^1.1.3",
    "datauri": "^4.1.0",
    "encoding": "^0.1.13",
    "eventemitter3": "^4.0.7",
    "legacy-encoding": "^3.0.0",
    "moment": "^2.29.4",
    "pcsclite": "^1.0.1"
  }
}
'@
}

function New-LiteReaderRuntimePackageJson {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  Write-GeneratedText -Path $Destination -Text @'
{
  "name": "thai-id-reader-lite-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@thai-id-intake/shared-types": "file:.reader-bootstrap/vendor/shared-types",
    "kafkajs": "^2.2.4",
    "nanoid": "^5.0.7",
    "thai-id-card-reader": "file:.reader-bootstrap/vendor/thai-id-card-reader",
    "zod": "^4.4.3"
  }
}
'@
}

function New-ReaderRuntimePackageJson {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  New-LiteReaderRuntimePackageJson -Destination $Destination
}

function Get-NodeRuntimeNpmCli {
  param(
    [Parameter(Mandatory = $true)]
    [string] $NodeDir
  )

  $npmCli = Join-Path $NodeDir "node_modules\npm\bin\npm-cli.js"
  Assert-PathExists -Path $npmCli -Type File
  $npmCli
}

function Install-NodeRuntimeInput {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $TargetRuntime
  )

  $cacheDir = Join-Path $Paths.ReleaseInputRoot ".cache"
  $zipPath = Join-Path $cacheDir $script:ReleaseNodeZipName
  $extractRoot = Join-Path $Paths.StagingRoot ("node-extract-" + [System.Guid]::NewGuid().ToString("N"))

  Save-VerifiedDownload -Uri $script:ReleaseNodeZipUrl -Destination $zipPath -ExpectedSha256 $script:ReleaseNodeZipSha256

  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

  try {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $extracted = Join-Path $extractRoot "node-v26.4.0-win-x64"
    Assert-PathExists -Path (Join-Path $extracted "node.exe") -Type File

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetRuntime) | Out-Null
    if (Test-Path -LiteralPath $TargetRuntime) {
      Remove-Item -LiteralPath $TargetRuntime -Recurse -Force
    }
    Move-Item -LiteralPath $extracted -Destination $TargetRuntime

    $nodeExe = Join-Path $TargetRuntime "node.exe"
    $version = (& $nodeExe --version).Trim()
    $abi = (& $nodeExe -p "process.versions.modules").Trim()
    if ($version -ne $script:ReleaseNodeVersion -or $abi -ne $script:ReleaseNodeAbi) {
      throw "Downloaded Node reported $version ABI $abi; expected $script:ReleaseNodeVersion ABI $script:ReleaseNodeAbi."
    }

    $nodeHash = Get-FileSha256 -Path $nodeExe
    Write-GeneratedText -Path (Join-Path $TargetRuntime "RUNTIME_MANIFEST.txt") -Text @"
Runtime: Node.js $script:ReleaseNodeVersion
Platform: Windows x64
Node ABI: $script:ReleaseNodeAbi
Source: $script:ReleaseNodeZipUrl
SHA-256 (node.exe): $nodeHash
Purpose: Pinned portable runtime for the bundled pcsclite native addon.
"@
  } finally {
    if (Test-Path -LiteralPath $extractRoot) {
      Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
  }
}

function Invoke-NpmWithNodeRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string] $NodeDir,

    [Parameter(Mandatory = $true)]
    [string[]] $Arguments,

    [Parameter(Mandatory = $true)]
    [string] $WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  $nodeExe = Join-Path $NodeDir "node.exe"
  $npmCli = Get-NodeRuntimeNpmCli -NodeDir $NodeDir
  Invoke-RequiredProcess -FilePath $nodeExe -Arguments (@($npmCli) + $Arguments) -WorkingDirectory $WorkingDirectory -Description $Description
}

function Repair-PcscliteProject {
  param(
    [Parameter(Mandatory = $true)]
    [string] $PcscliteDir
  )

  $projectFile = Join-Path $PcscliteDir "build\pcsclite.vcxproj"
  Assert-PathExists -Path $projectFile -Type File
  $project = Get-Content -Raw -LiteralPath $projectFile
  $project = $project.Replace("-flto=thin", "").Replace("/opt:lldltojobs=2", "")
  Set-Content -LiteralPath $projectFile -Value $project -Encoding UTF8
}

function Build-PcscliteInput {
  param(
    [Parameter(Mandatory = $true)]
    [string] $NodeDir,

    [Parameter(Mandatory = $true)]
    [string] $ReaderRuntimeRoot
  )

  $nodeExe = Join-Path $NodeDir "node.exe"
  $nodeGypCli = Join-Path $NodeDir "node_modules\npm\node_modules\node-gyp\bin\node-gyp.js"
  $pcscliteDir = Join-Path $ReaderRuntimeRoot "node_modules\pcsclite"
  Assert-PathExists -Path $nodeGypCli -Type File
  Assert-PathExists -Path $pcscliteDir -Type Directory

  Invoke-RequiredProcess -FilePath $nodeExe -Arguments @($nodeGypCli, "configure") -WorkingDirectory $pcscliteDir -Description "Configuring pcsclite native addon"
  Repair-PcscliteProject -PcscliteDir $pcscliteDir
  Invoke-RequiredProcess -FilePath $nodeExe -Arguments @($nodeGypCli, "build") -WorkingDirectory $pcscliteDir -Description "Building pcsclite native addon"

  Push-Location $ReaderRuntimeRoot
  try {
    Invoke-RequiredProcess -FilePath $nodeExe -Arguments @("-e", "require('pcsclite'); console.log('pcsclite loaded')") -WorkingDirectory $ReaderRuntimeRoot -Description "Validating pcsclite native addon"
  } finally {
    Pop-Location
  }
}

function Prepare-LiteReleaseInput {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $StageRoot
  )

  $target = Join-Path $StageRoot "lite\reader-agent"
  $vendorRoot = Join-Path $target ".reader-bootstrap\vendor"
  New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null

  Copy-ThaiIdCardReaderVendor -Paths $Paths -Destination (Join-Path $vendorRoot "thai-id-card-reader")
  Copy-SharedTypesRuntimePackage -Paths $Paths -Destination (Join-Path $vendorRoot "shared-types")
  New-LiteReaderRuntimePackageJson -Destination (Join-Path $target "package.json")

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "npm is required to generate the lite reader package lock."
  }

  Invoke-RequiredProcess `
    -FilePath $npm.Source `
    -Arguments @("install", "--package-lock-only", "--ignore-scripts", "--omit=dev", "--no-audit", "--fund=false") `
    -WorkingDirectory $target `
    -Description "Generating lite reader bootstrap package-lock.json"
}

function Prepare-FullReleaseInput {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $StageRoot
  )

  $fullRoot = Join-Path $StageRoot "full"
  $downloads = Join-Path $Paths.ReleaseInputRoot ".cache"
  $kafkaArchive = Join-Path $downloads "$script:KafkaName.tgz"
  $kafkaChecksum = Join-Path $downloads "$script:KafkaName.tgz.sha512"
  $nodeDir = Join-Path $fullRoot "reader-agent\runtime\node"

  Save-VerifiedKafkaArchive -ArchivePath $kafkaArchive -ChecksumPath $kafkaChecksum
  $kafkaExtractRoot = Join-Path $Paths.StagingRoot ("kafka-extract-" + [System.Guid]::NewGuid().ToString("N"))
  try {
    Expand-TarGz -ArchivePath $kafkaArchive -Destination $kafkaExtractRoot
    Copy-DirectoryExact -Source (Join-Path $kafkaExtractRoot $script:KafkaName) -Destination (Join-Path $fullRoot "server\kafka_2.13-4.3.1")
  } finally {
    if (Test-Path -LiteralPath $kafkaExtractRoot) {
      Remove-Item -LiteralPath $kafkaExtractRoot -Recurse -Force
    }
  }

  Install-NodeRuntimeInput -Paths $Paths -TargetRuntime $nodeDir

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "npm is required to prepare full server dependencies."
  }

  $serverWorkspace = Join-Path $Paths.StagingRoot ("full-server-workspace-" + [System.Guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Force -Path $serverWorkspace | Out-Null
    Copy-GitTrackedWorkspaceFiles -Paths $Paths -Destination $serverWorkspace -Pathspecs @(
      "package.json",
      "package-lock.json",
      ".npmrc",
      "apps/backend/package.json",
      "packages/shared-types/package.json"
    )
    Invoke-RequiredProcess `
      -FilePath $npm.Source `
      -Arguments @("ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--fund=false", "--include-workspace-root", "--workspace", "@thai-id-intake/shared-types", "--workspace", "@thai-id-intake/backend") `
      -WorkingDirectory $serverWorkspace `
      -Description "Installing full server production dependencies"
    Copy-DirectoryExact -Source (Join-Path $serverWorkspace "node_modules") -Destination (Join-Path $fullRoot "server\backend\node_modules")
    Copy-SharedTypesRuntimePackage -Paths $Paths -Destination (Join-Path $fullRoot "server\backend\node_modules\@thai-id-intake\shared-types")
  } finally {
    if (Test-Path -LiteralPath $serverWorkspace) {
      Remove-Item -LiteralPath $serverWorkspace -Recurse -Force
    }
  }

  $readerRuntime = Join-Path $Paths.StagingRoot ("full-reader-runtime-" + [System.Guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Force -Path $readerRuntime | Out-Null
    $vendorRoot = Join-Path $readerRuntime ".reader-bootstrap\vendor"
    Copy-ThaiIdCardReaderVendor -Paths $Paths -Destination (Join-Path $vendorRoot "thai-id-card-reader")
    Copy-SharedTypesRuntimePackage -Paths $Paths -Destination (Join-Path $vendorRoot "shared-types")
    New-ReaderRuntimePackageJson -Destination (Join-Path $readerRuntime "package.json")

    Invoke-NpmWithNodeRuntime `
      -NodeDir $nodeDir `
      -Arguments @("install", "--omit=dev", "--ignore-scripts", "--no-audit", "--fund=false") `
      -WorkingDirectory $readerRuntime `
      -Description "Installing full reader production dependencies"
    Build-PcscliteInput -NodeDir $nodeDir -ReaderRuntimeRoot $readerRuntime
    Copy-DirectoryExact -Source (Join-Path $readerRuntime "node_modules") -Destination (Join-Path $fullRoot "reader-agent\node_modules")
    Copy-SharedTypesRuntimePackage -Paths $Paths -Destination (Join-Path $fullRoot "reader-agent\node_modules\@thai-id-intake\shared-types")
  } finally {
    if (Test-Path -LiteralPath $readerRuntime) {
      Remove-Item -LiteralPath $readerRuntime -Recurse -Force
    }
  }
}

function Invoke-PrepareReleaseInput {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [ValidateSet("full", "lite", "all")]
    [string] $Mode,

    [switch] $ForceReplaceInput
  )

  $modes = if ($Mode -eq "all") { @("full", "lite") } else { @($Mode) }
  $stageRoot = Join-Path $Paths.StagingRoot ("release-input-" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss"))
  Assert-PathInside -Parent $Paths.WorkspaceRoot -Child $stageRoot

  foreach ($modeName in $modes) {
    $target = Join-Path $Paths.ReleaseInputRoot $modeName
    if ((Test-Path -LiteralPath $target) -and -not $ForceReplaceInput) {
      throw "Refusing to replace existing release input: $target. Remove it first or rerun with -ForceReplaceInput."
    }
  }

  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

  try {
    foreach ($modeName in $modes) {
      if ($modeName -eq "full") {
        Prepare-FullReleaseInput -Paths $Paths -StageRoot $stageRoot
      } else {
        Prepare-LiteReleaseInput -Paths $Paths -StageRoot $stageRoot
      }
    }

    foreach ($modeName in $modes) {
      $target = Join-Path $Paths.ReleaseInputRoot $modeName
      $source = Join-Path $stageRoot $modeName
      Assert-PathExists -Path $source -Type Directory
      New-Item -ItemType Directory -Force -Path $Paths.ReleaseInputRoot | Out-Null
      if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
      }
      Move-Item -LiteralPath $source -Destination $target
      Write-Host "Prepared release input: $target"
    }
  } finally {
    if (Test-Path -LiteralPath $stageRoot) {
      Assert-PathInside -Parent $Paths.StagingRoot -Child $stageRoot
      Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
  }
}
