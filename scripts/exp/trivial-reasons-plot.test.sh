#!/usr/bin/env bash
# End-to-end check for the F6 zero-reason bars: regenerate the figure
# CSV, rebuild both PDFs, fail on undefined references or overfull
# boxes, render the figure pages at 80 dpi, and print the sha256 of
# the regenerated CSV and the rendered pages.
# See scripts/exp/trivial-reasons-plot.failure-modes.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

node scripts/exp/trivial-reasons-plot.mjs

ROWS=$(($(wc -l < paper/generated/trivial-reasons-plot.csv) - 1))
[ "$ROWS" = "22" ] || { echo "plot rows: $ROWS, want 22"; exit 1; }
awk -F, 'NR>1 { s=$2+$3+$4+$5+$6; if (s!=0 && (s<99.9 || s>100.1)) { print "row " NR " shares " s; exit 1 } }' \
  paper/generated/trivial-reasons-plot.csv \
  || { echo "a bar does not sum to 100"; exit 1; }

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references or overfull boxes above"
    exit 1
  fi
done

figpage() { # $1 = pdf path; prints the page holding the reasons caption
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null | grep -q "zero-score rows die"; then
      echo "$i"; return
    fi
  done
  echo "reasons caption not found in $1" >&2
  exit 1
}

MP=$(figpage paper/main.pdf)
DP=$(figpage paper/main-dmlr.pdf)
pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/f6-main"
pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/f6-dmlr"

sha256sum paper/generated/trivial-reasons-plot.csv "$OUT"/f6-main-*.png "$OUT"/f6-dmlr-*.png
echo "$ROWS bars, pages $MP/$DP rendered -> trivial-reasons, ok"
