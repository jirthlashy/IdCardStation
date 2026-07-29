Set-StrictMode -Version Latest

function Get-FileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertTo-Sha256Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Value
  )

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
  } finally {
    $sha.Dispose()
  }
}

function Get-DirectoryDigest {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Root
  )

  if (-not (Test-Path -LiteralPath $Root)) {
    return $null
  }

  $lines = Get-ChildItem -LiteralPath $Root -File -Recurse |
    Sort-Object FullName |
    ForEach-Object {
      $relative = Get-RelativeDeployPath -Root $Root -Path $_.FullName
      "$relative=$((Get-FileSha256 -Path $_.FullName))"
    }

  ConvertTo-Sha256Hex -Value ($lines -join "`n")
}

function Get-BundleFileChecksums {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot
  )

  Get-ChildItem -LiteralPath $BundleRoot -File -Recurse |
    Where-Object { (Get-RelativeDeployPath -Root $BundleRoot -Path $_.FullName) -ne "BUNDLE_MANIFEST.json" } |
    Sort-Object FullName |
    ForEach-Object {
      [pscustomobject]@{
        path = Get-RelativeDeployPath -Root $BundleRoot -Path $_.FullName
        sha256 = Get-FileSha256 -Path $_.FullName
        bytes = $_.Length
      }
    }
}

function Get-GitMetadata {
  param(
    [Parameter(Mandatory = $true)]
    [string] $WorkspaceRoot
  )

  $commit = $null
  $shortCommit = "nogit"
  $dirty = $null

  try {
    $commit = (& git -C $WorkspaceRoot rev-parse HEAD 2>$null).Trim()
    $shortCommit = (& git -C $WorkspaceRoot rev-parse --short=12 HEAD 2>$null).Trim()
    $status = (& git -C $WorkspaceRoot status --porcelain 2>$null)
    $dirty = [bool]$status
  } catch {
    $dirty = $null
  }

  [pscustomobject]@{
    commit = $commit
    shortCommit = $shortCommit
    dirty = $dirty
  }
}

function Get-TrackedDeployScriptHashes {
  param(
    [Parameter(Mandatory = $true)]
    [string] $PathsRoot,

    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("full", "lite")]
    [string] $Mode
  )

  $readerRoot = Join-Path $PathsRoot "reader-agent\windows"
  $serverRoot = Join-Path $PathsRoot "server\$Mode"

  $scriptPairs = @(
    @{ source = Join-Path $readerRoot "Thai ID Reader.bat"; bundle = "reader-agent/Thai ID Reader.bat" },
    @{ source = Join-Path $readerRoot "support\THAI_ID_READER_LAUNCHER.ps1"; bundle = "reader-agent/.reader-support/THAI_ID_READER_LAUNCHER.ps1" },
    @{ source = Join-Path $readerRoot "support\RUN_READER_AGENT_BACKGROUND.ps1"; bundle = "reader-agent/.reader-support/RUN_READER_AGENT_BACKGROUND.ps1" },
    @{ source = Join-Path $readerRoot "support\STOP_READER_AGENT.ps1"; bundle = "reader-agent/.reader-support/STOP_READER_AGENT.ps1" }
  )

  if ($Mode -eq "lite") {
    $scriptPairs += @{ source = Join-Path $readerRoot "lite\INSTALL_READER.ps1"; bundle = "reader-agent/.reader-support/INSTALL_READER.ps1" }
  }

  Get-ChildItem -LiteralPath $serverRoot -File |
    Where-Object { $_.Extension -eq ".sh" } |
    Sort-Object Name |
    ForEach-Object {
      $scriptPairs += @{ source = $_.FullName; bundle = "server/$($_.Name)" }
    }

  $scriptPairs | ForEach-Object {
    [pscustomobject]@{
      source = Get-RelativeDeployPath -Root $PathsRoot -Path $_.source
      bundle = $_.bundle
      sourceSha256 = Get-FileSha256 -Path $_.source
      bundleSha256 = Get-FileSha256 -Path (Join-DeployPath -Root $BundleRoot -RelativePath $_.bundle)
    }
  }
}

function New-BundleManifest {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BundleRoot,

    [ValidateSet("full", "lite")]
    [string] $Mode,

    [Parameter(Mandatory = $true)]
    [pscustomobject] $Paths
  )

  $git = Get-GitMetadata -WorkspaceRoot $Paths.WorkspaceRoot
  $workspaceLockfile = Join-Path $Paths.WorkspaceRoot "package-lock.json"
  $liteReaderLockfile = Join-Path $BundleRoot "reader-agent\package-lock.json"
  $nodeManifest = Join-Path $BundleRoot "reader-agent\runtime\node\RUNTIME_MANIFEST.txt"
  $nodeExe = Join-Path $BundleRoot "reader-agent\runtime\node\node.exe"

  $artifactSources = @()
  if ($Mode -eq "full") {
    foreach ($relative in @(
      "full/server/backend/node_modules",
      "full/server/kafka_2.13-4.3.1",
      "full/reader-agent/node_modules",
      "full/reader-agent/runtime"
    )) {
      $sourcePath = Join-DeployPath -Root $Paths.ReleaseInputRoot -RelativePath $relative
      $artifactSources += [pscustomobject]@{
        path = "release-input/$relative"
        sha256 = Get-DirectoryDigest -Root $sourcePath
      }
    }
  } else {
    foreach ($relative in @(
      "lite/reader-agent/package-lock.json",
      "lite/reader-agent/.reader-bootstrap/vendor/thai-id-card-reader"
    )) {
      $sourcePath = Join-DeployPath -Root $Paths.ReleaseInputRoot -RelativePath $relative
      $hash = if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
        Get-FileSha256 -Path $sourcePath
      } else {
        Get-DirectoryDigest -Root $sourcePath
      }
      $artifactSources += [pscustomobject]@{
        path = "release-input/$relative"
        sha256 = $hash
      }
    }
  }

  $manifest = [pscustomobject]@{
    schemaVersion = 1
    mode = $Mode
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    git = $git
    lockfiles = [pscustomobject]@{
      workspace = if (Test-Path -LiteralPath $workspaceLockfile) { Get-FileSha256 -Path $workspaceLockfile } else { $null }
      liteReader = if (Test-Path -LiteralPath $liteReaderLockfile) { Get-FileSha256 -Path $liteReaderLockfile } else { $null }
    }
    node = [pscustomobject]@{
      expectedVersion = if ($Mode -eq "full") { "v26.4.0" } else { $null }
      expectedAbi = if ($Mode -eq "full") { "147" } else { $null }
      runtimeManifestSha256 = if (Test-Path -LiteralPath $nodeManifest) { Get-FileSha256 -Path $nodeManifest } else { $null }
      nodeExeSha256 = if (Test-Path -LiteralPath $nodeExe) { Get-FileSha256 -Path $nodeExe } else { $null }
    }
    artifactSources = $artifactSources
    trackedDeployScripts = Get-TrackedDeployScriptHashes -PathsRoot $Paths.DeployScriptRoot -BundleRoot $BundleRoot -Mode $Mode
    fileChecksums = Get-BundleFileChecksums -BundleRoot $BundleRoot
  }

  $manifestPath = Join-Path $BundleRoot "BUNDLE_MANIFEST.json"
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  $manifestPath
}
