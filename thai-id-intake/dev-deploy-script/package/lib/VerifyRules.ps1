Set-StrictMode -Version Latest

function Get-BundleMode {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("auto", "full", "lite")]
    [string] $Mode = "auto"
  )

  if ($Mode -ne "auto") {
    return $Mode
  }

  $leaf = Split-Path -Leaf $BundleRoot
  if ($leaf -eq "deploy-transfer") {
    return "full"
  }
  if ($leaf -eq "deploy-transfer-lite") {
    return "lite"
  }

  if (Test-Path -LiteralPath (Join-Path $BundleRoot "reader-agent\runtime\node\node.exe")) {
    return "full"
  }

  if (Test-Path -LiteralPath (Join-Path $BundleRoot "reader-agent\.reader-support\INSTALL_READER.ps1")) {
    return "lite"
  }

  throw "Could not infer bundle mode for: $BundleRoot"
}

function Assert-RequiredRelativePaths {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [Parameter(Mandatory = $true)]
    [string[]] $RelativePaths
  )

  foreach ($relative in $RelativePaths) {
    Assert-PathExists -Path (Join-DeployPath -Root $BundleRoot -RelativePath $relative) -Type Any
  }
}

function Assert-BundleShape {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("full", "lite")]
    [string] $Mode
  )

  $common = @(
    "README.md",
    "BUNDLE_MANIFEST.json",
    "server/README.md",
    "server/server.env",
    "server/START_SERVER_PM2.sh",
    "server/STOP_SERVER_PM2.sh",
    "server/stations.example.json",
    "reader-agent/README.md",
    "reader-agent/app/index.js",
    "reader-agent/app/package.json",
    "reader-agent/Thai ID Reader.bat",
    "reader-agent/.reader-support/THAI_ID_READER_LAUNCHER.ps1",
    "reader-agent/.reader-support/RUN_READER_AGENT_BACKGROUND.ps1",
    "reader-agent/.reader-support/STOP_READER_AGENT.ps1"
  )

  if ($Mode -eq "full") {
    Assert-RequiredRelativePaths -BundleRoot $BundleRoot -RelativePaths ($common + @(
      "server/backend/apps/backend/dist/index.js",
      "server/backend/apps/backend/package.json",
      "server/backend/node_modules",
      "server/kafka_2.13-4.3.1",
      "server/nurse-webapp/index.html",
      "server/station-display/index.html",
      "reader-agent/node_modules",
      "reader-agent/node_modules/pcsclite",
      "reader-agent/runtime/node/node.exe",
      "reader-agent/runtime/node/RUNTIME_MANIFEST.txt"
    ))
  } else {
    Assert-RequiredRelativePaths -BundleRoot $BundleRoot -RelativePaths ($common + @(
      "server/INSTALL_SERVER_DEPS.sh",
      "server/thai-id-intake/package.json",
      "server/thai-id-intake/package-lock.json",
      "server/thai-id-intake/apps/backend/src/index.ts",
      "server/thai-id-intake/apps/nurse-webapp/src/main.ts",
      "server/thai-id-intake/apps/station-display/src/main.ts",
      "server/thai-id-intake/packages/shared-types/src/index.ts",
      "reader-agent/package.json",
      "reader-agent/package-lock.json",
      "reader-agent/.reader-bootstrap/vendor/shared-types/dist/index.js",
      "reader-agent/.reader-bootstrap/vendor/shared-types/dist/index.d.ts",
      "reader-agent/.reader-bootstrap/vendor/thai-id-card-reader/build/index.js",
      "reader-agent/.reader-support/INSTALL_READER.ps1"
    ))
  }
}

function Assert-NoDeniedDeploymentFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("full", "lite")]
    [string] $Mode
  )

  $items = Get-ChildItem -LiteralPath $BundleRoot -Force -Recurse
  foreach ($item in $items) {
    $relative = Get-RelativeDeployPath -Root $BundleRoot -Path $item.FullName
    $relativeForMatch = "/$relative"

    if (
      $relativeForMatch -match "/\.reader-support/reader\.env$" -or
      $relativeForMatch -match "/\.reader-support/logs(/|$)" -or
      $relativeForMatch -match "/\.reader-agent\.pid$" -or
      $relativeForMatch -match "/reader-agent\.log$" -or
      $relativeForMatch -match "/(card-reads|pending-reads|reader-agent-logs)(/|$)" -or
      $relativeForMatch -match "\.card\.json$" -or
      $relativeForMatch -match "\.photo\.txt$"
    ) {
      throw "Denied machine-local or card-data artifact found: $relative"
    }

    if ($Mode -eq "lite") {
      if (
        $relativeForMatch -match "/reader-agent/runtime(/|$)" -or
        $relativeForMatch -match "/reader-agent/node_modules(/|$)" -or
        $relativeForMatch -match "/server/thai-id-intake/node_modules(/|$)" -or
        $relativeForMatch -match "/server/(backend|nurse-webapp|station-display|kafka_2\.13-4\.3\.1)(/|$)" -or
        $relativeForMatch -match "/pcsclite\.node$"
      ) {
        throw "Lite bundle contains forbidden generated/runtime artifact: $relative"
      }
    }
  }
}

function Test-PowerShellScriptsParse {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  Get-ChildItem -LiteralPath $BundleRoot -Filter "*.ps1" -File -Recurse | ForEach-Object {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref] $tokens, [ref] $errors) | Out-Null
    if ($errors.Count -gt 0) {
      $message = ($errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }) -join "; "
      throw "PowerShell parse failed for $($_.FullName): $message"
    }
  }
}

function Test-ShellScriptsParse {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  $candidateBashes = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files\Git\usr\bin\bash.exe"
  )

  $candidateBashes += (Get-Command bash.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
  $bashPath = $null

  foreach ($candidate in ($candidateBashes | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      continue
    }

    & $candidate --version *> $null
    if ($LASTEXITCODE -eq 0) {
      $bashPath = $candidate
      break
    }
  }

  if (-not $bashPath) {
    throw "bash is required to parse shell deployment scripts."
  }

  Get-ChildItem -LiteralPath $BundleRoot -Filter "*.sh" -File -Recurse | ForEach-Object {
    & $bashPath -n $_.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "bash -n failed for $($_.FullName)"
    }
  }
}

function Test-FullReaderRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  $readerRoot = Join-Path $BundleRoot "reader-agent"
  $nodeExe = Join-Path $readerRoot "runtime\node\node.exe"
  Assert-PathExists -Path $nodeExe -Type File

  Push-Location $readerRoot
  try {
    $script = 'const m=String.fromCharCode(112,99,115,99,108,105,116,101);require(m);console.log(process.version,process.versions.modules);'
    $output = & $nodeExe -e $script
    if ($LASTEXITCODE -ne 0) {
      throw "Bundled Node failed while loading pcsclite."
    }
    $info = (($output | Select-Object -Last 1) -split "\s+")
    if ($info.Count -lt 2) {
      throw "Could not parse bundled Node verification output: $output"
    }
    if ($info[0] -ne "v26.4.0") {
      throw "Expected bundled Node v26.4.0 but found $($info[0])."
    }
    if ($info[1] -ne "147") {
      throw "Expected Node ABI 147 but found $($info[1])."
    }
  } finally {
    Pop-Location
  }
}

function Test-ManifestChecksums {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("full", "lite")]
    [string] $Mode
  )

  $manifestPath = Join-Path $BundleRoot "BUNDLE_MANIFEST.json"
  Assert-PathExists -Path $manifestPath -Type File
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

  if ($manifest.mode -ne $Mode) {
    throw "Manifest mode mismatch. Expected $Mode, found $($manifest.mode)."
  }

  $recorded = @{}
  foreach ($entry in $manifest.fileChecksums) {
    $recorded[$entry.path] = $entry.sha256
    $filePath = Join-DeployPath -Root $BundleRoot -RelativePath $entry.path
    Assert-PathExists -Path $filePath -Type File
    $actual = Get-FileSha256 -Path $filePath
    if ($actual -ne $entry.sha256) {
      throw "Checksum mismatch for $($entry.path). Expected $($entry.sha256), found $actual."
    }
  }

  $actualFiles = Get-ChildItem -LiteralPath $BundleRoot -File -Recurse |
    ForEach-Object { Get-RelativeDeployPath -Root $BundleRoot -Path $_.FullName } |
    Where-Object { $_ -ne "BUNDLE_MANIFEST.json" }

  foreach ($file in $actualFiles) {
    if (-not $recorded.ContainsKey($file)) {
      throw "Manifest is missing checksum for $file."
    }
  }
}

function Test-TrackedScriptHashes {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("full", "lite")]
    [string] $Mode,

    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths
  )

  $manifest = Get-Content -Raw -LiteralPath (Join-Path $BundleRoot "BUNDLE_MANIFEST.json") | ConvertFrom-Json
  foreach ($script in $manifest.trackedDeployScripts) {
    $sourcePath = Join-DeployPath -Root $Paths.DeployScriptRoot -RelativePath $script.source
    $bundlePath = Join-DeployPath -Root $BundleRoot -RelativePath $script.bundle
    Assert-PathExists -Path $sourcePath -Type File
    Assert-PathExists -Path $bundlePath -Type File

    $sourceHash = Get-FileSha256 -Path $sourcePath
    $bundleHash = Get-FileSha256 -Path $bundlePath
    if ($sourceHash -ne $script.sourceSha256) {
      throw "Tracked source script changed after packaging: $($script.source)"
    }
    if ($bundleHash -ne $script.bundleSha256) {
      throw "Bundle script checksum changed after packaging: $($script.bundle)"
    }
    if ($sourceHash -ne $bundleHash) {
      throw "Copied script does not match tracked source: $($script.bundle)"
    }
  }
}

function Invoke-BundleVerification {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("auto", "full", "lite")]
    [string] $Mode = "auto",

    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths
  )

  Assert-PathExists -Path $BundleRoot -Type Directory
  $resolvedMode = Get-BundleMode -BundleRoot $BundleRoot -Mode $Mode

  Assert-BundleShape -BundleRoot $BundleRoot -Mode $resolvedMode
  Assert-NoDeniedDeploymentFiles -BundleRoot $BundleRoot -Mode $resolvedMode
  Test-PowerShellScriptsParse -BundleRoot $BundleRoot
  Test-ShellScriptsParse -BundleRoot $BundleRoot
  Test-ManifestChecksums -BundleRoot $BundleRoot -Mode $resolvedMode
  Test-TrackedScriptHashes -BundleRoot $BundleRoot -Mode $resolvedMode -Paths $Paths

  if ($resolvedMode -eq "full") {
    Test-FullReaderRuntime -BundleRoot $BundleRoot
  }

  Write-Host "Verified $resolvedMode deployment bundle: $BundleRoot"
}
