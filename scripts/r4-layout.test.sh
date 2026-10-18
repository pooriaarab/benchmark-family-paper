#!/usr/bin/env bash
# End-to-end check for the round-4 layout pass (issue #229): the
# Figure 9 legend placement, the Figure 7 near-line labels, the DMLR
# Table 11 longtable, and both PDFs built twice with identical
# sha256 and no float or box overflow.
# See scripts/r4-layout.failure-modes.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
node scripts/exp/trivial-scatter.mjs > "$OUT/scatter.log" 2>&1 \
  || { tail -10 "$OUT/scatter.log"; exit 1; }

echo "== the hidden-audit legend sits in the corner, not on the ticks"
grep -q 'at={(0.02,0.97)},anchor=north west' paper/figures/fig-hidden-audit.tex \
  || { echo "legend placement changed"; exit 1; }
if grep -q 'xticklabel\* cs' paper/figures/fig-hidden-audit.tex; then
  echo "legend anchored on the tick labels again"; exit 1
fi

echo "== the scatter splits near-line labels right of the y=x line"
grep -q 'trivial-scatter-online.csv' scripts/exp/trivial-scatter.mjs \
  || { echo "generator no longer splits the labels"; exit 1; }
grep -q 'table\[x=x,y=y,meta=label\] {generated/trivial-scatter-online.csv}' \
  paper/figures/fig-trivial-scatter.tex \
  || { echo "online label series missing"; exit 1; }
grep -q 'xshift=32pt' paper/figures/fig-trivial-scatter.tex \
  || { echo "label shift missing"; exit 1; }
python3 - <<'PY'
import csv
for row in csv.DictReader(open('paper/generated/trivial-scatter-online.csv')):
    assert float(row['x']) < 0.06, row
for row in csv.DictReader(open('paper/generated/trivial-scatter-notes.csv')):
    assert float(row['x']) >= 0.06, row
print('online/offline split ok')
PY

echo "== table 11 is a longtable"
grep -q '\\begin{longtable}' paper/sections/app-experiments.tex \
  || { echo "tab:experiments no longer a longtable"; exit 1; }
grep -q 'label{tab:experiments}' paper/sections/app-experiments.tex \
  || { echo "table label lost"; exit 1; }
awk '/begin{longtable}/{f=1} /end{longtable}/{f=0} f&&/begin{table}/{print; exit 1}' \
  paper/sections/app-experiments.tex || { echo "nested float"; exit 1; }

echo "== both builds run twice, fixed epoch, identical hashes"
export SOURCE_DATE_EPOCH=1729000000
build_round() {
  for target in pdf dmlr; do
    make "$target" > "$OUT/$1-$target.log" 2>&1 \
      || { tail -20 "$OUT/$1-$target.log"; exit 1; }
    if grep -iE 'undefined|citation.*undefined|[Oo]verfull|Float too large' \
        "$OUT/$1-$target.log"; then
      echo "make $target ($1): undefined refs, overfull or float too large above"
      exit 1
    fi
  done
  for f in paper/main.pdf paper/main-dmlr.pdf; do
    if grep -F '??' <<< "$(pdftotext "$f" - 2>/dev/null)" \
        | grep -vqF '?? "'; then
      echo "$f ($1): extracted text contains ??"; exit 1
    fi
  done
  sha256sum paper/main.pdf paper/main-dmlr.pdf
}
build_round first | tee "$OUT/hashes.first"
rm -f paper/main.pdf paper/main-dmlr.pdf
build_round second | tee "$OUT/hashes.second"
diff "$OUT/hashes.first" "$OUT/hashes.second" \
  || { echo 'PDF hashes differ between the two builds'; exit 1; }

echo "== render the changed pages at 80 dpi"
mkdir -p "$OUT/png"
for spec in "main 36" "main 37" "main-dmlr 44" "main-dmlr 49" "main-dmlr 51"; do
  set -- $spec
  pdftoppm -png -r 80 -f "$2" -l "$2" "paper/$1.pdf" "$OUT/png/$1-p$2"
done
ls "$OUT/png"

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "layout: legend cornered, labels shifted, table splits -> r4-layout, ok"
