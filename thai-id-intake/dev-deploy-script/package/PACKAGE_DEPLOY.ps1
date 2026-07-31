param(
  [ValidateSet("package", "prepare-input")]
  [string] $Action = "package",

  [Parameter(Mandatory = $true)]
  [ValidateSet("full", "lite", "all")]
  [string] $Mode,

  [ValidateSet("folder", "zip")]
  [string] $Output,

  [switch] $ForceReplace,

  [switch] $ForceReplaceInput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "lib\BundlePaths.ps1")
. (Join-Path $PSScriptRoot "lib\Manifest.ps1")
. (Join-Path $PSScriptRoot "lib\CopyDeployFiles.ps1")
. (Join-Path $PSScriptRoot "lib\VerifyRules.ps1")
. (Join-Path $PSScriptRoot "lib\PrepareReleaseInput.ps1")

$paths = Get-ReleaseCreatorPaths -PackageRoot $PSScriptRoot

if ($Action -eq "prepare-input") {
  Invoke-PrepareReleaseInput -Paths $paths -Mode $Mode -ForceReplaceInput:$ForceReplaceInput
  exit 0
}

if ($Mode -eq "all") {
  throw "Package action requires -Mode full or -Mode lite."
}

if (-not $Output) {
  throw "Package action requires -Output folder or -Output zip."
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$bundleFolderName = if ($Mode -eq "full") { "deploy-transfer" } else { "deploy-transfer-lite" }
$folderTargetRoot = if ($Mode -eq "full") { $paths.FullOutputRoot } else { $paths.LiteOutputRoot }

if ($Output -eq "folder" -and (Test-Path -LiteralPath $folderTargetRoot) -and -not $ForceReplace) {
  throw "Refusing to replace existing folder: $folderTargetRoot. Remove it first or rerun PACKAGE_DEPLOY.ps1 with -ForceReplace."
}

$stageRoot = Join-Path $paths.StagingRoot "$Mode-$timestamp"
$stageBundleRoot = Join-Path $stageRoot $bundleFolderName

Write-Host "Preparing $Mode deployment bundle in staging..."
Assert-PathInside -Parent $paths.WorkspaceRoot -Child $stageRoot
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageBundleRoot | Out-Null

try {
  if ($Mode -eq "full") {
    Build-FullDeployBundle -Paths $paths -BundleRoot $stageBundleRoot
  } else {
    Build-LiteDeployBundle -Paths $paths -BundleRoot $stageBundleRoot
  }

  Write-Host "Writing bundle manifest..."
  New-BundleManifest -BundleRoot $stageBundleRoot -Mode $Mode -Paths $paths | Out-Null
  Write-Host "Verifying staged $Mode bundle..."
  Invoke-BundleVerification -BundleRoot $stageBundleRoot -Mode $Mode -Paths $paths

  if ($Output -eq "folder") {
    $targetRoot = $folderTargetRoot
    if (Test-Path -LiteralPath $targetRoot) {
      Assert-PathInside -Parent $paths.RepoRoot -Child $targetRoot
      Remove-Item -LiteralPath $targetRoot -Recurse -Force
    }

    Move-Item -LiteralPath $stageBundleRoot -Destination $targetRoot
    Write-Host "Created $Mode folder bundle: $targetRoot"
  } else {
    Write-Host "Creating $Mode ZIP archive..."
    New-Item -ItemType Directory -Force -Path $paths.ReleaseRoot | Out-Null
    $git = Get-GitMetadata -WorkspaceRoot $paths.WorkspaceRoot
    $zipName = "thai-id-intake-$Mode-$timestamp-$($git.shortCommit).zip"
    $zipPath = Join-Path $paths.ReleaseRoot $zipName
    if (Test-Path -LiteralPath $zipPath) {
      Remove-Item -LiteralPath $zipPath -Force
    }

    Compress-Archive -LiteralPath $stageBundleRoot -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "Created $Mode ZIP bundle: $zipPath"
  }
} finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Assert-PathInside -Parent $paths.StagingRoot -Child $stageRoot
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}
