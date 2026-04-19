param(
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [switch]$IncludeSource
)

$ErrorActionPreference = 'Stop'

$appDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$workspaceRoot = Resolve-Path (Join-Path $appDir '..')

$sha = (git -C $appDir rev-parse --short HEAD).Trim()
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'

$releasesRoot = Join-Path $workspaceRoot 'deliverables\lms-app\releases'
$releaseDir = Join-Path $releasesRoot ("$stamp-$sha")
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

Write-Host "Release dir: $releaseDir"

if (-not $SkipTests) {
  Write-Host 'Running tests...'
  Push-Location $appDir
  try {
    npm test
  } finally {
    Pop-Location
  }
}

if (-not $SkipBuild) {
  Write-Host 'Building...'
  Push-Location $appDir
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

$distDir = Join-Path $appDir 'dist'
if (-not (Test-Path $distDir)) {
  throw "dist/ not found: $distDir"
}

# 1) dist.zip (upload to Xserver / rollback)
$distZip = Join-Path $releaseDir "dist_${stamp}_${sha}.zip"
if (Test-Path $distZip) { Remove-Item -Force $distZip }
Compress-Archive -Path (Join-Path $distDir '*') -DestinationPath $distZip

# 2) Package A (deploy bundle)
$pkgName = "lms-app-deploy-A-${stamp}-${sha}"
$pkgDir = Join-Path $releaseDir $pkgName
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null

Copy-Item -Force -LiteralPath $distZip -Destination (Join-Path $pkgDir 'dist.zip')
Copy-Item -Force -LiteralPath (Join-Path $appDir '.env.example') -Destination (Join-Path $pkgDir '.env.example')
Copy-Item -Force -LiteralPath (Join-Path $appDir 'README.md') -Destination (Join-Path $pkgDir 'README.md')
Copy-Item -Force -Recurse -LiteralPath (Join-Path $appDir 'ops') -Destination (Join-Path $pkgDir 'ops')
Copy-Item -Force -Recurse -LiteralPath (Join-Path $appDir 'supabase') -Destination (Join-Path $pkgDir 'supabase')

@(
  "created_at_jst=$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))",
  "git_sha=$sha",
  "includes=dist.zip, supabase/, ops/, README.md, .env.example"
) | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $pkgDir 'BUILD_INFO.txt')

$zipA = Join-Path $releaseDir "lms-app_A_deploy_${stamp}_${sha}.zip"
if (Test-Path $zipA) { Remove-Item -Force $zipA }
Compress-Archive -Path $pkgDir -DestinationPath $zipA

# 3) Optional: Package B (source bundle)
if ($IncludeSource) {
  $zipB = Join-Path $releaseDir "lms-app_B_source_${stamp}_${sha}.zip"
  if (Test-Path $zipB) { Remove-Item -Force $zipB }
  git -C $appDir archive --format=zip --prefix=lms-app/ -o $zipB HEAD
}

Write-Host ''
Write-Host 'Artifacts created:'
Write-Host " - $distZip"
Write-Host " - $zipA"
if ($IncludeSource) {
  Write-Host " - $zipB"
}

