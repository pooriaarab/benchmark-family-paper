#!/usr/bin/env bash
# End-to-end check for figure F4 (the policy-tier ladder): regenerate
# the figure inputs, prove the outputs repeat byte for byte, check
# the wave split, the no-data marks and the point ranges, rebuild
# both PDFs twice with matching sha256, and render the figure page.
# See scripts/exp/policy-ladder.failure-modes.md for the checks.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

GEN=paper/generated
FILES="$GEN/policy-ladder-blind.csv $GEN/policy-ladder-taskaware.csv \
$GEN/policy-ladder-oracle.csv $GEN/policy-ladder-labels.csv \
$GEN/policy-ladder-stems.tex $GEN/policy-ladder-macros.tex"

echo "== regenerate twice, diff byte for byte"
node scripts/exp/policy-ladder.mjs > "$OUT/run1.log"
sha256sum $FILES > "$OUT/sha.first"
node scripts/exp/policy-ladder.mjs > "$OUT/run2.log"
sha256sum $FILES > "$OUT/sha.second"
diff "$OUT/sha.first" "$OUT/sha.second"
diff "$OUT/run1.log" "$OUT/run2.log"
cat "$OUT/sha.second"

echo "== freshness of the generated files"
node scripts/exp/policy-ladder.mjs --check
node scripts/exp/macros.mjs --check

echo "== wave, tier and no-data checks"
rows=$(($(wc -l < "$GEN/policy-ladder-labels.csv") - 1))
w1=$(sed -n 's/.*policyLadderWaveOneRows}{\([0-9]*\)}.*/\1/p' "$GEN/policy-ladder-macros.tex")
ta=$(($(wc -l < "$GEN/policy-ladder-taskaware.csv") - 1))
nd=$(grep -c 'no E2 row' "$GEN/policy-ladder-stems.tex")
[ "$rows" -gt 0 ] && [ -n "$w1" ] && [ "$w1" -lt "$rows" ] \
  || { echo "rows $rows / wave-1 rows $w1 look wrong"; exit 1; }
[ $((ta + nd)) = "$rows" ] \
  || { echo "task-aware $ta + no-data $nd != $rows rows"; exit 1; }
for f in blind taskaware oracle; do
  awk -F, 'FNR > 1 && ($1+0 < 0 || $1+0 > 1) { bad = 1 } END { exit bad }' \
    "$GEN/policy-ladder-$f.csv" \
    || { echo "a $f point sits outside [0,1]"; exit 1; }
done
# The prompt-reading tier must not exist: exactly three addplot series.
n=$(grep -c 'addplot' paper/figures/fig-ladder.tex)
[ "$n" = "3" ] || { echo "fig-ladder.tex draws $n series, want 3"; exit 1; }

echo "== float wiring"
for m in paper/main.tex paper/main-dmlr.tex; do
  n=$(grep -cF 'input{sections/prereg.tex}' "$m")
  [ "$n" = "1" ] || { echo "$m inputs prereg.tex $n times, want 1"; exit 1; }
done
n=$(grep -cF 'input{figures/fig-ladder.tex}' paper/sections/prereg.tex)
[ "$n" = "1" ] || { echo "prereg.tex inputs fig-ladder.tex $n times, want 1"; exit 1; }
grep -q 'label{fig:ladder}' paper/figures/fig-ladder.tex \
  || { echo 'fig-ladder.tex lost its label'; exit 1; }

echo "== build both PDFs twice with a fixed epoch"
export SOURCE_DATE_EPOCH=1729000000
build_round() { # $1 = round name
  for target in pdf dmlr; do
    make "$target" > "$OUT/$1-$target.log" 2>&1 \
      || { tail -20 "$OUT/$1-$target.log"; exit 1; }
    if grep -iE 'undefined|citation.*undefined|overfull' \
        "$OUT/$1-$target.log"; then
      echo "make $target ($1): undefined references, citations or overfull boxes above"
      exit 1
    fi
  done
  for f in paper/main.pdf paper/main-dmlr.pdf; do
    if grep -F '??' <<< "$(pdftotext "$f" - 2>/dev/null)" \
        | grep -vqF '?? "'; then
      echo "$f ($1): extracted text contains ?? (a broken reference)"
      exit 1
    fi
  done
  sha256sum paper/main.pdf paper/main-dmlr.pdf
}
build_round first | tee "$OUT/hashes.first"
rm -f paper/main.pdf paper/main-dmlr.pdf
build_round second | tee "$OUT/hashes.second"
diff "$OUT/hashes.first" "$OUT/hashes.second" \
  || { echo 'PDF hashes differ between the two builds'; exit 1; }

echo "== render the figure page from each PDF"
figpage() { # $1 = pdf path, $2 = unique caption fragment
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null | grep -q "$2"; then
      echo "$i"; return
    fi
  done
  echo "caption fragment '$2' not found in $1" >&2
  exit 1
}
FM=$(figpage paper/main.pdf "prompt-reading rung")
FD=$(figpage paper/main-dmlr.pdf "prompt-reading rung")
pdftoppm -png -r 80 -f "$FM" -l "$FM" paper/main.pdf "$OUT/f4-main"
pdftoppm -png -r 80 -f "$FD" -l "$FD" paper/main-dmlr.pdf "$OUT/f4-dmlr"
sha256sum "$OUT"/f4-main-*.png "$OUT"/f4-dmlr-*.png
echo "F4 on pages $FM/$FD -> policy-ladder, ok"
