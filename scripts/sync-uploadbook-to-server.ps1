param(
  [string]$Server = "root@74.48.5.83",
  [string]$LocalDir = "D:\00working\20260110_CODE_Lexiland_read\UPLOADBOOK",
  [string]$RemoteDir = "/srv/lexiland/data/library",
  [string]$StateFile = "D:\00working\20260110_CODE_Lexiland_read\TMP\uploadbook-sync-state.json"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $LocalDir)) {
  Write-Host "[UploadBookSync] Local directory not found: $LocalDir"
  exit 0
}

$allowedExtensions = @(".epub", ".txt", ".md", ".markdown")
$files = Get-ChildItem -LiteralPath $LocalDir -File | Where-Object {
  $allowedExtensions -contains $_.Extension.ToLowerInvariant()
}

if ($files.Count -eq 0) {
  Write-Host "[UploadBookSync] No supported files found in $LocalDir"
  exit 0
}

$previousState = @{}
if (Test-Path $StateFile) {
  try {
    $previousState = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json -AsHashtable
  } catch {
    $previousState = @{}
  }
}

$currentState = @{}
$changedFiles = @()
$removedFileNames = @()

foreach ($file in $files) {
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  $entry = @{
    hash = $hash
    size = $file.Length
    lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString("o")
  }
  $currentState[$file.Name] = $entry

  if (
    -not $previousState.ContainsKey($file.Name) -or
    $previousState[$file.Name].hash -ne $entry.hash
  ) {
    $changedFiles += $file
  }
}

foreach ($previousName in $previousState.Keys) {
  if (-not $currentState.ContainsKey($previousName)) {
    $removedFileNames += [string]$previousName
  }
}

if ($changedFiles.Count -eq 0 -and $removedFileNames.Count -eq 0) {
  Write-Host "[UploadBookSync] No new, changed, or removed files."
  exit 0
}

Write-Host "[UploadBookSync] Syncing to $Server`:$RemoteDir"
& ssh $Server "mkdir -p $RemoteDir" | Out-Null

foreach ($file in $changedFiles) {
  Write-Host "[UploadBookSync] -> $($file.Name)"
  & scp $file.FullName "${Server}:${RemoteDir}/"
}

foreach ($fileName in $removedFileNames) {
  $encodedName = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fileName))
  Write-Host "[UploadBookSync] x  $fileName"
  & ssh $Server "python3 - <<'PY'
import base64
import os

remote_dir = r'''$RemoteDir'''
name = base64.b64decode('$encodedName').decode('utf-8')
path = os.path.join(remote_dir, name)
if os.path.exists(path):
    os.remove(path)
PY"
}

$stateDir = Split-Path -Parent $StateFile
if (!(Test-Path $stateDir)) {
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
}
$currentState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StateFile -Encoding UTF8

Write-Host "[UploadBookSync] Sync complete."
