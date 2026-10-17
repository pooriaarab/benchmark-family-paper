#!/usr/bin/env bash
# End-to-end check for the F2 defect heatmap: regenerate the figure data
# from the committed CSVs, rebuild both PDFs, fail on undefined
# references or overfull boxes, render the figure pages at 80 dpi, and
# print the sha256 of the regenerated CSVs and the rendered pages.
# See scripts/heatmap.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

node scripts/collect.mjs --from-json > "$OUT/collect.log"
cat "$OUT/collect.log"

CLASSES=$(($(wc -l < paper/generated/defects-heatmap-classes.csv) - 1))
PACKAGES=$(($(wc -l < paper/data/review-rounds.csv) - 1))
CELLS=$(grep -cE '^[0-9]+,[0-9]+,[01]$' paper/generated/defects-heatmap.csv)
WANT=$((CLASSES * PACKAGES))
[ "$CELLS" = "$WANT" ] || { echo "heatmap cells: $CELLS, want $WANT"; exit 1; }

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references or overfull boxes above"
    exit 1
  fi
done

figpage() { # $1 = pdf path; prints the page holding the heatmap caption
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null | grep -q "margin bars count"; then
      echo "$i"; return
    fi
  done
  echo "figure caption not found in $1" >&2
  exit 1
}

MP=$(figpage paper/main.pdf)
DP=$(figpage paper/main-dmlr.pdf)
pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/f2-main"
pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/f2-dmlr"

sha256sum \
  paper/generated/defects-heatmap.csv \
  paper/generated/defects-heatmap-classes.csv \
  "$OUT"/f2-main-*.png "$OUT"/f2-dmlr-*.png
echo "$CLASSES classes x $PACKAGES packages, $CELLS cells, pages $MP/$DP rendered -> heatmap, ok"
