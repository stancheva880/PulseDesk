#!/usr/bin/env bash
#
# create-archive.sh — produce a clean source archive of PulseDesk.
#
# Excludes dependencies, build output, caches, the SQLite DB, and VCS/IDE/tooling dirs.
# KEEPS all .env files (real + .example) and frontend/public/usage.html.
#
# Format: prefers .zip (zip CLI, else Python's zipfile); falls back to .tar.gz.
# Output: written to the repo's parent directory by default, or to $1 if given.
# Usage:  bash create-archive.sh [output-dir]
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(basename "$ROOT_DIR")"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${1:-$(dirname "$ROOT_DIR")}"
BASE="$OUT_DIR/${PROJECT}-${STAMP}"

# --- Collect the file list once: single source of truth for what's excluded ---
LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT

(
  cd "$ROOT_DIR" && find . \
    -type d \( \
        -name node_modules -o -name .next -o -name dist -o -name build -o -name out \
        -o -name coverage -o -name .nyc_output -o -name .git -o -name .idea \
        -o -name .vscode -o -name .cache -o -name .turbo -o -name .claude \
      \) -prune -o \
    -type f \
        ! -name '*.db' ! -name '*.db-journal' ! -name '*.sqlite' ! -name '*.sqlite3' \
        ! -name '*.tsbuildinfo' ! -name '*.log' ! -name '.eslintcache' \
        -print
) | sed 's|^\./||' | sort > "$LIST"

COUNT="$(wc -l < "$LIST" | tr -d ' ')"
echo "Collected $COUNT files from $ROOT_DIR"

# --- Archive with the best available tool (paths are repo-relative) ---
if command -v zip >/dev/null 2>&1; then
  ARCHIVE="${BASE}.zip"
  ( cd "$ROOT_DIR" && zip -q "$ARCHIVE" -@ < "$LIST" )
elif command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  ARCHIVE="${BASE}.zip"
  PY="$(command -v python || command -v python3)"
  ( cd "$ROOT_DIR" && "$PY" - "$ARCHIVE" "$LIST" <<'PYEOF'
import sys, zipfile
archive, listfile = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    with open(listfile, encoding="utf-8") as f:
        for line in f:
            name = line.rstrip("\n")
            if name:
                z.write(name)
PYEOF
  )
else
  ARCHIVE="${BASE}.tar.gz"
  tar -czf "$ARCHIVE" -C "$ROOT_DIR" -T "$LIST"
fi

echo "Created: $ARCHIVE"
