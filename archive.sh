#!/usr/bin/env bash
# Zip the project, skipping dependencies, build output, the dev DB and real .env files.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: archive.sh [-o OUTPUT] [-e EXTRA]
  -o  output zip path (default ./pulsedesk-YYYYmmdd-HHMM.zip)
  -e  comma-separated extra files/dirs/globs to exclude, matched at any depth
  -h  this help
USAGE
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$root/pulsedesk-$(date +%Y%m%d-%H%M).zip"
extra=""

while getopts "o:e:h" opt; do
  case $opt in
    o) out="$OPTARG" ;;
    e) extra="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# names/globs excluded at any depth; .env is an exact name so *.example survives
patterns=(
  node_modules dist .next build coverage .git .idea .cache .eslintcache
  '*.tsbuildinfo' '*.log' '*.zip' .DS_Store Thumbs.db '*.stackdump'
  .env .env.local .env.docker '.env.*.local'
  '*.db' '*.db-journal' '*.sqlite' '*.sqlite3'
)
[[ -n $extra ]] && { IFS=, read -ra more <<<"$extra"; patterns+=("${more[@]}"); }

cd "$root"
if command -v zip >/dev/null; then
  ex=(); for p in "${patterns[@]}"; do ex+=(-x "$p" "*/$p" "$p/*" "*/$p/*"); done
  zip -qr "$out" . "${ex[@]}"
else
  command -v 7z >/dev/null || { echo "archive.sh: need zip or 7z (choco install zip / apt install zip)" >&2; exit 1; }
  ex=(); for p in "${patterns[@]}"; do ex+=("-xr!$p"); done
  7z a -tzip -bso0 -bsp0 "$out" . "${ex[@]}" >/dev/null
fi

echo "$out ($(du -h "$out" | cut -f1))"
