Set-StrictMode -Version Latest

function Get-ReleaseCreatorPaths {
  param(
    [Parameter(Mandatory = $true)]
    [string] $PackageRoot
  )

  $resolvedPackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
  $workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $resolvedPackageRoot "..\..")).Path
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $workspaceRoot "..")).Path

  [pscustomobject]@{
    PackageRoot = $resolvedPackageRoot
    WorkspaceRoot = $workspaceRoot
    RepoRoot = $repoRoot
    DeployScriptRoot = Join-Path $workspaceRoot "dev-deploy-script"
    ReaderScriptRoot = Join-Path $workspaceRoot "dev-deploy-script\reader-agent\windows"
    ServerScriptRoot = Join-Path $workspaceRoot "dev-deploy-script\server"
    StagingRoot = Join-Path $workspaceRoot ".deploy-staging"
    ReleaseRoot = Join-Path $repoRoot "release"
    ReleaseInputRoot = Join-Path $repoRoot "release-input"
    FullOutputRoot = Join-Path $repoRoot "deploy-transfer"
    LiteOutputRoot = Join-Path $repoRoot "deploy-transfer-lite"
  }
}

function Join-DeployPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Root,

    [Parameter(Mandatory = $true)]
    [string] $RelativePath
  )

  Join-Path $Root ($RelativePath -replace "/", [System.IO.Path]::DirectorySeparatorChar)
}

function Assert-PathExists {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [ValidateSet("File", "Directory", "Any")]
    [string] $Type = "Any"
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Required $($Type.ToLowerInvariant()) is missing: $Path"
  }

  $item = Get-Item -LiteralPath $Path
  if ($Type -eq "File" -and $item.PSIsContainer) {
    throw "Expected file but found directory: $Path"
  }

  if ($Type -eq "Directory" -and -not $item.PSIsContainer) {
    throw "Expected directory but found file: $Path"
  }
}

function Assert-PathInside {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Parent,

    [Parameter(Mandatory = $true)]
    [string] $Child
  )

  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd("\", "/")
  $childFull = [System.IO.Path]::GetFullPath($Child).TrimEnd("\", "/")
  $comparison = [System.StringComparison]::OrdinalIgnoreCase

  if ($childFull.Equals($parentFull, $comparison)) {
    return
  }

  $requiredPrefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $childFull.StartsWith($requiredPrefix, $comparison)) {
    throw "Refusing to operate outside $parentFull`: $childFull"
  }
}

function Get-RelativeDeployPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Root,

    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $rootUri = [System.Uri]::new($rootFull)
  $pathUri = [System.Uri]::new($pathFull)
  [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace("\", "/")
}
