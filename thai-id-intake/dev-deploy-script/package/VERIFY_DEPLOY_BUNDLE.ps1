param(
  [string] $BundlePath,

  [ValidateSet("auto", "full", "lite")]
  [string] $Mode = "auto"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "lib\BundlePaths.ps1")
. (Join-Path $PSScriptRoot "lib\Manifest.ps1")
. (Join-Path $PSScriptRoot "lib\VerifyRules.ps1")

$paths = Get-ReleaseCreatorPaths -PackageRoot $PSScriptRoot

function Invoke-VerificationForPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [ValidateSet("auto", "full", "lite")]
    [string] $RequestedMode
  )

  Assert-PathExists -Path $Path -Type Any
  $item = Get-Item -LiteralPath $Path

  if (-not $item.PSIsContainer -and $item.Extension -eq ".zip") {
    $extractRoot = Join-Path $paths.StagingRoot ("verify-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    try {
      Expand-Archive -LiteralPath $item.FullName -DestinationPath $extractRoot -Force
      $candidates = @(Get-ChildItem -LiteralPath $extractRoot -Directory |
        Where-Object { $_.Name -eq "deploy-transfer" -or $_.Name -eq "deploy-transfer-lite" })
      if ($candidates.Count -ne 1) {
        throw "Expected ZIP to contain exactly one deploy-transfer or deploy-transfer-lite root folder."
      }
      Invoke-BundleVerification -BundleRoot $candidates[0].FullName -Mode $RequestedMode -Paths $paths
    } finally {
      if (Test-Path -LiteralPath $extractRoot) {
        Assert-PathInside -Parent $paths.StagingRoot -Child $extractRoot
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
      }
    }
    return
  }

  if (-not $item.PSIsContainer) {
    throw "BundlePath must be a directory or .zip file: $Path"
  }

  Invoke-BundleVerification -BundleRoot $item.FullName -Mode $RequestedMode -Paths $paths
}

if ($BundlePath) {
  Invoke-VerificationForPath -Path $BundlePath -RequestedMode $Mode
  exit 0
}

$verifiedAny = $false
foreach ($candidate in @($paths.FullOutputRoot, $paths.LiteOutputRoot)) {
  if (Test-Path -LiteralPath $candidate -PathType Container) {
    if (Test-Path -LiteralPath (Join-Path $candidate "BUNDLE_MANIFEST.json") -PathType Leaf) {
      Invoke-VerificationForPath -Path $candidate -RequestedMode "auto"
      $verifiedAny = $true
    } else {
      Write-Warning "Skipping existing folder without BUNDLE_MANIFEST.json: $candidate"
    }
  }
}

if ($verifiedAny) {
  exit 0
}

if (Test-Path -LiteralPath $paths.ReleaseRoot -PathType Container) {
  foreach ($modeName in @("full", "lite")) {
    $zip = Get-ChildItem -LiteralPath $paths.ReleaseRoot -Filter "thai-id-intake-$modeName-*.zip" -File |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($zip) {
      Invoke-VerificationForPath -Path $zip.FullName -RequestedMode $modeName
      $verifiedAny = $true
    }
  }
}

if (-not $verifiedAny) {
  throw "No manifest-bearing deploy folder or release ZIP exists. Pass -BundlePath to verify a staged folder or ZIP."
}
