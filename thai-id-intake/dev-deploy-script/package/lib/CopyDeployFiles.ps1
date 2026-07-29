Set-StrictMode -Version Latest

function Copy-DirectoryExact {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Source,

    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  Assert-PathExists -Path $Source -Type Directory
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Source,

    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  Assert-PathExists -Path $Source -Type Directory
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Copy-FilteredDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Source,

    [Parameter(Mandatory = $true)]
    [string] $Destination,

    [string[]] $ExcludedDirectoryNames = @("node_modules", "dist", ".vite"),

    [string[]] $ExcludedFileNames = @(".env", ".env.local")
  )

  Assert-PathExists -Path $Source -Type Directory
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($_.PSIsContainer) {
      if (-not ($ExcludedDirectoryNames -contains $_.Name)) {
        Copy-FilteredDirectory `
          -Source $_.FullName `
          -Destination (Join-Path $Destination $_.Name) `
          -ExcludedDirectoryNames $ExcludedDirectoryNames `
          -ExcludedFileNames $ExcludedFileNames
      }
    } else {
      if (-not ($ExcludedFileNames -contains $_.Name)) {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Force
      }
    }
  }
}

function Copy-GitTrackedWorkspaceFiles {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $Destination,

    [Parameter(Mandatory = $true)]
    [string[]] $Pathspecs
  )

  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) {
    throw "git is required to copy tracked lite server source files."
  }

  $trackedFiles = @(& $git.Source -C $Paths.WorkspaceRoot ls-files -- $Pathspecs)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed while collecting lite server source files."
  }

  if ($trackedFiles.Count -eq 0) {
    throw "No tracked source files matched lite server package pathspecs."
  }

  foreach ($relative in $trackedFiles) {
    $source = Join-DeployPath -Root $Paths.WorkspaceRoot -RelativePath $relative
    $target = Join-DeployPath -Root $Destination -RelativePath $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

function Write-GeneratedText {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Text
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Text.TrimStart() | Set-Content -LiteralPath $Path -Encoding utf8
}

function Get-ServerEnvTemplate {
@'
# Server startup config.
# Keep SERVER_IP=auto for VM testing, or replace it with the fixed server IP.
SERVER_IP=auto

KAFKA_PORT=9092
BACKEND_PORT=3001
NURSE_WEB_PORT=3000
STATION_DISPLAY_PORT=3002

STATION_ID=A01
ALLOWED_STATION_IDS=A01
# Optional: use a station registry file instead of ALLOWED_STATION_IDS.
# STATIONS_CONFIG_PATH=stations.example.json

MANAGE_UFW_RULES=true

SCAN_REQUEST_TTL_SECONDS=90
STATION_COOLDOWN_MS=3000
QUEUED_REQUEST_MAX_AGE_SECONDS=300
RESULT_AUTO_CLEAR_SECONDS=120
MAX_QUEUE_DEPTH_PER_STATION=10
SCAN_REQUEST_RATE_LIMIT_WINDOW_MS=60000
SCAN_REQUEST_RATE_LIMIT_MAX=20
READER_HEARTBEAT_MS=10000
'@
}

function Get-FullRootReadme {
@'
# Thai ID Intake Full Bundle

This transfer bundle has two machine-specific folders:

- `server/` goes to the Ubuntu/Linux server and includes Kafka, backend runtime,
  and built static web apps.
- `reader-agent/` goes to the Windows x64 PC connected to the physical smart
  card reader and includes its private Node runtime and production dependencies.

Configure `server/server.env` before starting the server. On the reader PC,
double-click `reader-agent/Thai ID Reader.bat`.
'@
}

function Get-LiteRootReadme {
@'
# Thai ID Intake Lite Bundle

This transfer bundle has two machine-specific folders:

- `server/` goes to the Ubuntu/Linux server. It installs dependencies and builds
  runtime output on that machine.
- `reader-agent/` goes to the Windows x64 reader PC. Its first launch installs a
  private Node runtime, npm packages, and the native PC/SC addon.

Use the full bundle instead for restricted or offline reader PCs.
'@
}

function Get-FullServerReadme {
@'
# Thai ID Intake Server Bundle

This folder goes on the Ubuntu/server PC.

Edit `server.env`, then start with:

```bash
bash START_SERVER_PM2.sh
pm2 list
```

Stop with:

```bash
bash STOP_SERVER_PM2.sh
```

The bundle includes Kafka, backend runtime files, and built nurse/station static
web apps. Use a fixed `SERVER_IP` for real deployment; `SERVER_IP=auto` is only
for quick VM testing.
'@
}

function Get-LiteServerReadme {
@'
# Thai ID Intake Lite Server Bundle

This is the Ubuntu/Linux server half of the lightweight deployment bundle. It
begins with source code only and creates runtime output during installation.

```bash
cd server
nano server.env
bash INSTALL_SERVER_DEPS.sh
bash START_SERVER_PM2.sh
pm2 list
```

The installer requires Java, Node/npm, Python 3, Bash, PM2, `tar`, and either
`curl` or `wget`, plus outbound access to npm and the Apache Kafka archive.
'@
}

function Get-FullReaderReadme {
@'
# Thai ID Reader - Full Offline Bundle

This complete Windows x64 reader package starts without internet access, a
system Node installation, npm, Python, or Visual Studio Build Tools.

Double-click `Thai ID Reader.bat`, enter the server IP, Kafka port, station ID,
and reader ID, then select `Start Reader`. Keep the CMD window open while the
reader is in use.

The bundled Node runtime is `v26.4.0` with ABI `147`, matched to the prebuilt
`pcsclite` native addon. Do not replace `node.exe` or run npm inside this folder.
'@
}

function Get-LiteReaderReadme {
@'
# Thai ID Reader - Lite Online Bundle

This small Windows x64 reader transfer is for PCs with internet access. Its
first launch installs a private Node runtime and reader dependencies locally,
then compiles `pcsclite` for that runtime.

Double-click `Thai ID Reader.bat` and approve the one-time administrator prompt.
Later launches validate the installed runtime and open the GUI immediately.

The first launch needs internet access to `nodejs.org`, the npm registry, and
Microsoft/Windows Package Manager download sources. Use the full reader bundle
for a fully offline reader PC.
'@
}

function Copy-ReaderLauncher {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $ReaderRoot,

    [switch] $IncludeLiteInstaller
  )

  $sourceRoot = $Paths.ReaderScriptRoot
  $supportSource = Join-Path $sourceRoot "support"
  $supportTarget = Join-Path $ReaderRoot ".reader-support"
  New-Item -ItemType Directory -Force -Path $supportTarget | Out-Null

  Copy-Item -LiteralPath (Join-Path $sourceRoot "Thai ID Reader.bat") -Destination (Join-Path $ReaderRoot "Thai ID Reader.bat") -Force

  foreach ($scriptName in @(
    "THAI_ID_READER_LAUNCHER.ps1",
    "RUN_READER_AGENT_BACKGROUND.ps1",
    "STOP_READER_AGENT.ps1"
  )) {
    Copy-Item -LiteralPath (Join-Path $supportSource $scriptName) -Destination (Join-Path $supportTarget $scriptName) -Force
  }

  if ($IncludeLiteInstaller) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot "lite\INSTALL_READER.ps1") -Destination (Join-Path $supportTarget "INSTALL_READER.ps1") -Force
  }
}

function Write-AppModulePackageJson {
  param(
    [Parameter(Mandatory = $true)]
    [string] $AppRoot
  )

  Write-GeneratedText -Path (Join-Path $AppRoot "package.json") -Text '{ "type": "module" }'
}

function Write-LiteReaderPackageJson {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ReaderRoot
  )

  Write-GeneratedText -Path (Join-Path $ReaderRoot "package.json") -Text @'
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

function Copy-SharedTypesVendor {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $VendorRoot
  )

  $sharedDist = Join-Path $Paths.WorkspaceRoot "packages\shared-types\dist"
  Assert-PathExists -Path (Join-Path $sharedDist "index.js") -Type File
  Assert-PathExists -Path (Join-Path $sharedDist "index.d.ts") -Type File

  $target = Join-Path $VendorRoot "shared-types"
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-DirectoryExact -Source $sharedDist -Destination (Join-Path $target "dist")
  Write-GeneratedText -Path (Join-Path $target "package.json") -Text @'
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

function Remove-MachineLocalFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  $deniedNames = @(
    "reader.env",
    ".reader-agent.pid",
    "reader-agent.log",
    "dev-server.log",
    "dev-server.err.log"
  )

  Get-ChildItem -LiteralPath $BundleRoot -Force -Recurse |
    Where-Object {
      $deniedNames -contains $_.Name -or
      $_.Name -like "*.card.json" -or
      $_.Name -like "*.photo.txt" -or
      $_.FullName -match "[\\/](card-reads|pending-reads|reader-agent-logs)[\\/]"
    } |
    Sort-Object FullName -Descending |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

function Build-FullDeployBundle {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  $artifactRoot = Join-Path $Paths.ReleaseInputRoot "full"
  $serverRoot = Join-Path $BundleRoot "server"
  $readerRoot = Join-Path $BundleRoot "reader-agent"

  foreach ($required in @(
    "server/backend/node_modules",
    "server/kafka_2.13-4.3.1",
    "reader-agent/node_modules",
    "reader-agent/runtime"
  )) {
    Assert-PathExists -Path (Join-DeployPath -Root $artifactRoot -RelativePath $required) -Type Directory
  }

  foreach ($required in @(
    "apps/backend/dist/index.js",
    "apps/nurse-webapp/dist/index.html",
    "apps/station-display/dist/index.html",
    "apps/reader-agent/dist/index.js"
  )) {
    Assert-PathExists -Path (Join-DeployPath -Root $Paths.WorkspaceRoot -RelativePath $required) -Type File
  }

  Write-GeneratedText -Path (Join-Path $BundleRoot "README.md") -Text (Get-FullRootReadme)
  Write-GeneratedText -Path (Join-Path $serverRoot "README.md") -Text (Get-FullServerReadme)
  Write-GeneratedText -Path (Join-Path $serverRoot "server.env") -Text (Get-ServerEnvTemplate)
  Copy-Item -LiteralPath (Join-Path $Paths.WorkspaceRoot "stations.example.json") -Destination (Join-Path $serverRoot "stations.example.json") -Force
  Copy-DirectoryContents -Source (Join-Path $Paths.ServerScriptRoot "full") -Destination $serverRoot

  Copy-DirectoryExact -Source (Join-Path $artifactRoot "server\kafka_2.13-4.3.1") -Destination (Join-Path $serverRoot "kafka_2.13-4.3.1")
  Copy-DirectoryExact -Source (Join-Path $artifactRoot "server\backend\node_modules") -Destination (Join-Path $serverRoot "backend\node_modules")
  Copy-DirectoryExact -Source (Join-Path $Paths.WorkspaceRoot "apps\backend\dist") -Destination (Join-Path $serverRoot "backend\apps\backend\dist")
  Copy-Item -LiteralPath (Join-Path $Paths.WorkspaceRoot "apps\backend\package.json") -Destination (Join-Path $serverRoot "backend\apps\backend\package.json") -Force

  Copy-DirectoryContents -Source (Join-Path $Paths.WorkspaceRoot "apps\nurse-webapp\dist") -Destination (Join-Path $serverRoot "nurse-webapp")
  Copy-DirectoryContents -Source (Join-Path $Paths.WorkspaceRoot "apps\station-display\dist") -Destination (Join-Path $serverRoot "station-display")

  Write-GeneratedText -Path (Join-Path $readerRoot "README.md") -Text (Get-FullReaderReadme)
  Copy-DirectoryExact -Source (Join-Path $Paths.WorkspaceRoot "apps\reader-agent\dist") -Destination (Join-Path $readerRoot "app")
  Write-AppModulePackageJson -AppRoot (Join-Path $readerRoot "app")
  Copy-DirectoryExact -Source (Join-Path $artifactRoot "reader-agent\node_modules") -Destination (Join-Path $readerRoot "node_modules")
  Copy-DirectoryExact -Source (Join-Path $artifactRoot "reader-agent\runtime") -Destination (Join-Path $readerRoot "runtime")
  Copy-ReaderLauncher -Paths $Paths -ReaderRoot $readerRoot

  Remove-MachineLocalFiles -BundleRoot $BundleRoot
}

function Build-LiteDeployBundle {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths,

    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  $liteInputRoot = Join-Path $Paths.ReleaseInputRoot "lite"
  $serverRoot = Join-Path $BundleRoot "server"
  $readerRoot = Join-Path $BundleRoot "reader-agent"

  foreach ($required in @(
    "reader-agent/package-lock.json",
    "reader-agent/.reader-bootstrap/vendor/thai-id-card-reader"
  )) {
    Assert-PathExists -Path (Join-DeployPath -Root $liteInputRoot -RelativePath $required) -Type Any
  }

  foreach ($required in @(
    "apps/reader-agent/dist/index.js",
    "packages/shared-types/dist/index.js",
    "packages/shared-types/dist/index.d.ts"
  )) {
    Assert-PathExists -Path (Join-DeployPath -Root $Paths.WorkspaceRoot -RelativePath $required) -Type File
  }

  Write-GeneratedText -Path (Join-Path $BundleRoot "README.md") -Text (Get-LiteRootReadme)
  Write-GeneratedText -Path (Join-Path $serverRoot "README.md") -Text (Get-LiteServerReadme)
  Write-GeneratedText -Path (Join-Path $serverRoot "server.env") -Text (Get-ServerEnvTemplate)
  Copy-Item -LiteralPath (Join-Path $Paths.WorkspaceRoot "stations.example.json") -Destination (Join-Path $serverRoot "stations.example.json") -Force
  Copy-DirectoryContents -Source (Join-Path $Paths.ServerScriptRoot "lite") -Destination $serverRoot

  $serverWorkspace = Join-Path $serverRoot "thai-id-intake"
  New-Item -ItemType Directory -Force -Path $serverWorkspace | Out-Null
  Copy-GitTrackedWorkspaceFiles -Paths $Paths -Destination $serverWorkspace -Pathspecs @(
    "package.json",
    "package-lock.json",
    ".npmrc",
    "tsconfig.json",
    "vitest.config.ts",
    "stations.example.json",
    "apps/backend",
    "apps/nurse-webapp",
    "apps/station-display",
    "packages/shared-types"
  )

  Write-GeneratedText -Path (Join-Path $readerRoot "README.md") -Text (Get-LiteReaderReadme)
  Copy-DirectoryExact -Source (Join-Path $Paths.WorkspaceRoot "apps\reader-agent\dist") -Destination (Join-Path $readerRoot "app")
  Write-AppModulePackageJson -AppRoot (Join-Path $readerRoot "app")
  Write-LiteReaderPackageJson -ReaderRoot $readerRoot
  Copy-Item -LiteralPath (Join-Path $liteInputRoot "reader-agent\package-lock.json") -Destination (Join-Path $readerRoot "package-lock.json") -Force
  $vendorRoot = Join-Path $readerRoot ".reader-bootstrap\vendor"
  Copy-DirectoryExact -Source (Join-Path $liteInputRoot "reader-agent\.reader-bootstrap\vendor\thai-id-card-reader") -Destination (Join-Path $vendorRoot "thai-id-card-reader")
  Copy-SharedTypesVendor -Paths $Paths -VendorRoot $vendorRoot
  Copy-ReaderLauncher -Paths $Paths -ReaderRoot $readerRoot -IncludeLiteInstaller

  Remove-MachineLocalFiles -BundleRoot $BundleRoot
}
