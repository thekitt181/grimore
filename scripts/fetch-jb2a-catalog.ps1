# Extracts JB2A WebM assets for all spells in spellEffectsCatalog.ts
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$catalogPath = Join-Path $root 'apps\client\src\systems\spells\spellEffectsCatalog.ts'
$destRoot = Join-Path $root 'apps\client\public\jb2a\Library'
$zipPath = Join-Path $env:TEMP 'grimoire-jb2a-module-0.9.0.zip'

if (-not (Test-Path $zipPath)) {
  Write-Host 'JB2A zip not found. Run fetch-jb2a-spells.ps1 once or set JB2A zip at' $zipPath
  exit 1
}

$src = Get-Content $catalogPath -Raw
$basenames = [regex]::Matches($src, '"basename": "([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
Write-Host "Extracting WebMs for $($basenames.Count) JB2A basenames..."

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$count = 0
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ($name -notmatch '\.webm$') { continue }
    $matched = $false
    foreach ($base in $basenames) {
      if ($name -like "*${base}_*") { $matched = $true; break }
    }
    if (-not $matched) { continue }
    $idx = $name.IndexOf('Library/')
    if ($idx -lt 0) { continue }
    $rel = $name.Substring($idx + 'Library/'.Length)
    $out = Join-Path $destRoot $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $out -Parent) | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true)
    $count++
  }
} finally {
  $zip.Dispose()
}

Write-Host "Extracted $count WebM files to $destRoot"
