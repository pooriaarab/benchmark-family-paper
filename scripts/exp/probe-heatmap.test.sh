#!/usr/bin/env bash
# End-to-end check for the F7 probe heatmap: regenerate the figure
# inputs twice and diff the sha256 lists, rebuild both PDFs, fail on
# undefined references or overfull boxes, and render the figure pages
# at 80 dpi for review. See
# scripts/exp/probe-heatmap.failure-modes.md for what each step catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

OUTPUTS="paper/generated/probe-heatmap.csv
paper/generated/probe-heatmap-cols.csv
paper/generated/probe-heatmap-rows.csv
paper/generated/probe-heatmap-fails.csv
paper/generated/probe-heatmap-hatch.tex
paper/generated/probe-heatmap-macros.tex"

node scripts/exp/probe-heatmap.mjs
sha256sum $OUTPUTS | tee "$OUT/first.sha"
node scripts/exp/probe-heatmap.mjs
sha256sum $OUTPUTS | tee "$OUT/second.sha"
diff "$OUT/first.sha" "$OUT/second.sha"

CELLS=$(($(wc -l < paper/generated/probe-heatmap.csv) - 1))
ROWS=$(($(wc -l < paper/generated/probe-heatmap-rows.csv) - 1))
COLS=$(($(wc -l < paper/generated/probe-heatmap-cols.csv) - 1))
[ "$CELLS" = "$((ROWS * COLS))" ] || { echo "grid $ROWS x $COLS != $CELLS cells"; exit 1; }
[ "$ROWS" = "34" ] || { echo "rows: $ROWS, want 34"; exit 1; }
[ "$COLS" = "17" ] || { echo "cols: $COLS, want 17"; exit 1; }

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references or overfull boxes above"
    exit 1
  fi
done

figpage() { # $1 = pdf path; prints the page holding the probe caption
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null | grep -q "Contract probes on the"; then
      echo "$i"; return
    fi
  done
  echo "probe caption not found in $1" >&2
  exit 1
}

MP=$(figpage paper/main.pdf)
DP=$(figpage paper/main-dmlr.pdf)
pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/f7-main"
pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/f7-dmlr"
sha256sum "$OUT"/f7-main-*.png "$OUT"/f7-dmlr-*.png

if [ -n "$(git status --porcelain $OUTPUTS)" ]; then
  echo "regeneration left uncommitted output"
  exit 1
fi
echo "$ROWS x $COLS probe cells, pages $MP/$DP rendered -> probe-heatmap, ok"
