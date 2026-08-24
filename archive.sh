#!/usr/bin/env bash
# Zip the project, skipping dependencies, build output, the dev DB and real .env files.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: archive.sh [-o OUTPUT] [-e EXTRA] [SUBDIR]
  -o      output zip path (default ./pulsedesk[-SUBDIR]-YYYYmmdd-HHMM.zip)
  -e      comma-separated extra files/dirs/globs to exclude, matched at any depth
  SUBDIR  zip only this subdirectory of the repo (e.g. frontend, backend) -
          for uploading a single app to Vercel's manual/zip deploy flow
  -h      this help
USAGE
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out=""
extra=""

while getopts "o:e:h" opt; do
  case $opt in
    o) out="$OPTARG" ;;
    e) extra="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

sub="${1:-}"
root="$repo_root"
if [[ -n $sub ]]; then
  root="$repo_root/$sub"
  [[ -d "$root" ]] || { echo "archive.sh: no such directory: $sub" >&2; exit 1; }
fi
[[ -z $out ]] && out="$repo_root/pulsedesk${sub:+-$sub}-$(date +%Y%m%d-%H%M).zip"

# names/globs excluded at any depth; .env is an exact name so *.example survives
patterns=(
  node_modules dist .next build coverage .git .idea .cache .eslintcache
  '*.tsbuildinfo' '*.log' '*.zip' .DS_Store Thumbs.db '*.stackdump'
  .env .env.local .env.docker '.env.*.local'
  '*.db' '*.db-journal' '*.sqlite' '*.sqlite3'
)
[[ -n $extra ]] && { IFS=, read -ra more <<<"$extra"; patterns+=("${more[@]}"); }

ps_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

cd "$root"
if command -v zip >/dev/null; then
  ex=(); for p in "${patterns[@]}"; do ex+=(-x "$p" "*/$p" "$p/*" "*/$p/*"); done
  zip -qr "$out" . "${ex[@]}"
elif command -v 7z >/dev/null; then
  ex=(); for p in "${patterns[@]}"; do ex+=("-xr!$p"); done
  7z a -tzip -bso0 -bsp0 "$out" . "${ex[@]}" >/dev/null
elif command -v powershell.exe >/dev/null; then
  # No zip/7z installed - fall back to PowerShell's built-in ZipFile, which
  # every Windows machine already has.
  win_root="$(pwd -W)"
  win_out="$(cd "$(dirname "$out")" && printf '%s/%s' "$(pwd -W)" "$(basename "$out")")"
  ps1="$(mktemp --suffix=.ps1)"
  {
    echo '$ErrorActionPreference = "Stop"'
    printf '$root = %s\n' "$(ps_quote "$win_root")"
    printf '$out = %s\n' "$(ps_quote "$win_out")"
    printf '$patterns = @('
    for i in "${!patterns[@]}"; do
      [[ $i -gt 0 ]] && printf ','
      printf '%s' "$(ps_quote "${patterns[$i]}")"
    done
    echo ')'
    cat <<'PS'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $out) { Remove-Item $out -Force }
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
function Add-Tree($dir, $relPrefix) {
  foreach ($item in Get-ChildItem -LiteralPath $dir -Force) {
    $excluded = $false
    foreach ($p in $patterns) {
      if ($item.Name -like $p) { $excluded = $true; break }
    }
    if ($excluded) { continue }
    $rel = if ($relPrefix) { "$relPrefix/$($item.Name)" } else { $item.Name }
    if ($item.PSIsContainer) {
      Add-Tree $item.FullName $rel
    } else {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
}
Add-Tree $root ''
$zip.Dispose()
PS
  } >"$ps1"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cd "$(dirname "$ps1")" && pwd -W)/$(basename "$ps1")"
  rm -f "$ps1"
else
  echo "archive.sh: need zip, 7z, or PowerShell (choco install zip / apt install zip)" >&2
  exit 1
fi

echo "$out ($(du -h "$out" | cut -f1))"
