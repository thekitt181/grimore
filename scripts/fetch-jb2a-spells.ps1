# Downloads JB2A free module and extracts spell WebM files used by Grimoire.
$ErrorActionPreference = 'Stop'
$zipUrl = 'https://github.com/Jules-Bens-Aa/JB2A_DnD5e/releases/download/0.9.0/module-0.9.0.zip'
$zipPath = Join-Path $env:TEMP 'grimoire-jb2a-module-0.9.0.zip'
$destRoot = Join-Path $PSScriptRoot '..\apps\client\public\jb2a\Library'
$neededSuffixes = @(
  'Library/3rd_Level/Fireball/FireballExplosion_01_Orange_800x800.webm',
  'Library/1st_Level/Burning_Hands/BurningHands_01_Regular_Orange_600x600.webm',
  'Library/3rd_Level/Lightning_Bolt/LightningBolt_01_Regular_Blue_4000x200.webm',
  'Library/1st_Level/Fog_Cloud/FogCloud_01_White_800x800.webm',
  'Library/3rd_Level/Spirit_Guardians/SpiritGuardians_01_Light_BlueYellow_600x600.webm'
)

if (-not (Test-Path $zipPath)) {
  Write-Host "Downloading JB2A module (~1.6 GB). This can take several minutes..."
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
} else {
  Write-Host "Using cached zip at $zipPath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($zip.Entries | Where-Object {
    $name = $_.FullName.Replace('\', '/')
    foreach ($suffix in $neededSuffixes) {
      if ($name.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
  })

  if ($entries.Count -eq 0) {
    Write-Host 'Could not find spell assets in zip. Sample entries:'
    $zip.Entries | Select-Object -First 20 | ForEach-Object { Write-Host $_.FullName }
    exit 1
  }

  foreach ($entry in $entries) {
    $normalized = $entry.FullName.Replace('\', '/')
    $libraryIdx = $normalized.LastIndexOf('Library/', [StringComparison]::OrdinalIgnoreCase)
    if ($libraryIdx -lt 0) { continue }
    $rel = $normalized.Substring($libraryIdx + 'Library/'.Length)
    $outPath = Join-Path $destRoot $rel
    $outDir = Split-Path $outPath -Parent
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    Write-Host "Extracting $rel"
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $outPath, $true)
    $size = (Get-Item $outPath).Length
    Write-Host "  OK ($size bytes)"
  }
} finally {
  $zip.Dispose()
}

Write-Host "Done. Assets in $destRoot"
