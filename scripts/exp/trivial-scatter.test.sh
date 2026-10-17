#!/usr/bin/env bash
# End-to-end check for the F5 trivial scatter: regenerate the figure
# CSVs, rebuild both PDFs, fail on undefined references or overfull
# boxes, render the figure pages at 80 dpi, and print the sha256 of
# the regenerated CSVs and the rendered pages.
# See scripts/exp/trivial-scatter.failure-modes.md for the checks.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

node scripts/exp/trivial-scatter.mjs

W1=$(($(wc -l < paper/generated/trivial-scatter.csv) - 1))
W2=$(($(wc -l < paper/generated/trivial-scatter-rug.csv) - 1))
[ "$W1" = "12" ] || { echo "wave-1 rows: $W1, want 12"; exit 1; }
[ "$W2" = "10" ] || { echo "wave-2 rows: $W2, want 10"; exit 1; }

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references or overfull boxes above"
    exit 1
  fi
done

figpage() { # $1 = pdf path; prints the page holding the scatter caption
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null | grep -q "lane below the axis"; then
      echo "$i"; return
    fi
  done
  echo "scatter caption not found in $1" >&2
  exit 1
}

MP=$(figpage paper/main.pdf)
DP=$(figpage paper/main-dmlr.pdf)
pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/f5-main"
pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/f5-dmlr"

sha256sum \
  paper/generated/trivial-scatter.csv \
  paper/generated/trivial-scatter-rug.csv \
  paper/generated/trivial-scatter-notes.csv \
  "$OUT"/f5-main-*.png "$OUT"/f5-dmlr-*.png
echo "$W1 wave-1 points + $W2 rug marks, pages $MP/$DP rendered -> trivial-scatter, ok"
