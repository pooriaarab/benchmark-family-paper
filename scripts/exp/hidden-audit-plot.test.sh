#!/usr/bin/env bash
# End-to-end check for the F8 hidden-split audit figure. See
# scripts/exp/hidden-audit-plot.failure-modes.md for what each step catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

OUTPUTS="paper/generated/hidden-audit-leaks.csv
paper/generated/hidden-audit-cols.csv
paper/generated/hidden-audit-rows.csv
paper/generated/hidden-audit-overlap.csv
paper/generated/hidden-audit-qrows.csv
paper/generated/hidden-audit-macros.tex"

node scripts/exp/hidden-audit-plot.mjs
sha256sum $OUTPUTS | tee "$OUT/first.sha"
node scripts/exp/hidden-audit-plot.mjs
sha256sum $OUTPUTS | tee "$OUT/second.sha"
diff "$OUT/first.sha" "$OUT/second.sha"

node scripts/exp/macros.mjs --check > /dev/null

CELLS=$(($(wc -l < paper/generated/hidden-audit-leaks.csv) - 1))
ROWS=$(($(wc -l < paper/generated/hidden-audit-rows.csv) - 1))
COLS=$(($(wc -l < paper/generated/hidden-audit-cols.csv) - 1))
QROWS=$(($(wc -l < paper/generated/hidden-audit-qrows.csv) - 1))
OCELLS=$(($(wc -l < paper/generated/hidden-audit-overlap.csv) - 1))
[ "$CELLS" = "$((ROWS * COLS))" ] || { echo "grid $ROWS x $COLS != $CELLS cells"; exit 1; }
[ "$ROWS" = "34" ] || { echo "rows: $ROWS, want 34"; exit 1; }
[ "$COLS" = "3" ] || { echo "cols: $COLS, want 3"; exit 1; }
[ "$QROWS" = "4" ] || { echo "qualified rows: $QROWS, want 4"; exit 1; }
[ "$OCELLS" = "20" ] || { echo "overlap cells: $OCELLS, want 20"; exit 1; }

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references or overfull boxes above"
    exit 1
  fi
done

figpage() { # $1 = pdf path; prints the page holding the audit caption
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null | grep -q "Hidden-split hygiene on the"; then
      echo "$i"; return
    fi
  done
  echo "audit caption not found in $1" >&2
  exit 1
}

MP=$(figpage paper/main.pdf)
DP=$(figpage paper/main-dmlr.pdf)
pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/f8-main"
pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/f8-dmlr"
sha256sum "$OUT"/f8-main-*.png "$OUT"/f8-dmlr-*.png

if [ -n "$(git status --porcelain $OUTPUTS paper/generated/exp-macros.tex)" ]; then
  echo "regeneration left uncommitted output"
  exit 1
fi
echo "$ROWS x $COLS leak cells, $QROWS qualified x 5 seeds, pages $MP/$DP rendered -> hidden-audit-plot, ok"
