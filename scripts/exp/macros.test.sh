#!/usr/bin/env bash
# End-to-end check for the experiment macros. Proves both guards fire
# on doctored inputs (restored on exit), regenerates
# paper/generated/exp-macros.tex, rebuilds both PDFs, and prints the
# sha256 of the generated file. See
# scripts/exp/macros.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
cp paper/data/exp/trivial-reasons.csv "$OUT/reasons.bak"
cp paper/data/exp/trivial-headroom.csv "$OUT/headroom.bak"
cp paper/data/exp/contract-probes.csv "$OUT/probes.bak"
cp paper/data/exp/exploit-results-a.csv "$OUT/expla.bak"
cleanup() {
  rm -f paper/sections/__exp-check-probe.tex
  cp "$OUT/reasons.bak" paper/data/exp/trivial-reasons.csv
  cp "$OUT/headroom.bak" paper/data/exp/trivial-headroom.csv
  cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv
  cp "$OUT/expla.bak" paper/data/exp/exploit-results-a.csv
  rm -rf "$OUT"
}
trap cleanup EXIT

echo "== guard: an \\exp* macro used in text but not generated fails"
echo 'probe \expNoSuchMacro' > paper/sections/__exp-check-probe.tex
if node scripts/exp/macros.mjs --check; then
  echo "missing-macro guard did not fire"
  exit 1
fi
rm paper/sections/__exp-check-probe.tex

echo "== guard: a CSV change without regeneration fails"
sed -i '2s/,[0-9]*$/,999999/' paper/data/exp/trivial-reasons.csv
if node scripts/exp/macros.mjs --check; then
  echo "stale-output guard did not fire"
  exit 1
fi
cp "$OUT/reasons.bak" paper/data/exp/trivial-reasons.csv

echo "== guard: a whole version arm with no measured best fails"
awk -F, 'NR == FNR { if ($2 == "0.2.0") old[$1] = 1; next }
         FNR == 1 { print; next }
         ($1 in old) && $2 == "0.1.0" { print $1 "," $2 "," $3 "," $4 ",,"; next }
         { print }' \
  paper/data/exp/trivial-headroom.csv paper/data/exp/trivial-headroom.csv \
  > "$OUT/headroom.csv"
mv "$OUT/headroom.csv" paper/data/exp/trivial-headroom.csv
if node scripts/exp/macros.mjs --check; then
  echo "missing-arm guard did not fire"
  exit 1
fi
cp "$OUT/headroom.bak" paper/data/exp/trivial-headroom.csv

# The contract-probe guards below doctor contract-probes.csv row 2 and
# grep the stderr message so each named guard, not the staleness guard,
# is what fires.
echo "== guard: a probe id outside the frozen list fails"
awk -F, 'BEGIN{OFS=","} NR==2 {$3="hv-not-a-probe"} {print}' \
  paper/data/exp/contract-probes.csv > "$OUT/probes.csv"
mv "$OUT/probes.csv" paper/data/exp/contract-probes.csv
if node scripts/exp/macros.mjs --check > "$OUT/err" 2>&1; then
  echo "frozen-probe guard did not fire"
  exit 1
fi
grep -q "not in the frozen list" "$OUT/err" || { cat "$OUT/err"; exit 1; }
cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv

echo "== guard: a row class that is not the frozen kind fails"
awk -F, 'BEGIN{OFS=","} NR==2 {$4="attack-A"} {print}' \
  paper/data/exp/contract-probes.csv > "$OUT/probes.csv"
mv "$OUT/probes.csv" paper/data/exp/contract-probes.csv
if node scripts/exp/macros.mjs --check > "$OUT/err" 2>&1; then
  echo "frozen-kind guard did not fire"
  exit 1
fi
grep -q "!= frozen kind" "$OUT/err" || { cat "$OUT/err"; exit 1; }
cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv

echo "== guard: a missing artifact x probe cell fails"
sed -i '2d' paper/data/exp/contract-probes.csv
if node scripts/exp/macros.mjs --check > "$OUT/err" 2>&1; then
  echo "missing-cell guard did not fire"
  exit 1
fi
grep -q "missing cell" "$OUT/err" || { cat "$OUT/err"; exit 1; }
cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv

echo "== guard: a duplicated artifact x probe cell fails"
sed -i '2{p}' paper/data/exp/contract-probes.csv
if node scripts/exp/macros.mjs --check > "$OUT/err" 2>&1; then
  echo "duplicate-cell guard did not fire"
  exit 1
fi
grep -q "duplicate cell" "$OUT/err" || { cat "$OUT/err"; exit 1; }
cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv

echo "== guard: an outside_contract flag that disagrees with result fails"
awk -F, 'BEGIN{OFS=","} NR==2 {$NF="yes"} {print}' \
  paper/data/exp/contract-probes.csv > "$OUT/probes.csv"
mv "$OUT/probes.csv" paper/data/exp/contract-probes.csv
if node scripts/exp/macros.mjs --check > "$OUT/err" 2>&1; then
  echo "outside-contract-flag guard did not fire"
  exit 1
fi
grep -q "outside_contract flag disagrees" "$OUT/err" || { cat "$OUT/err"; exit 1; }
cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv

echo "== guard: a quoted reason with a comma and doubled quotes still parses"
sed -i '2s/"[^"]*"/"has ""inner"" quotes, and a comma"/' \
  paper/data/exp/contract-probes.csv
node scripts/exp/macros.mjs
cp "$OUT/probes.bak" paper/data/exp/contract-probes.csv
node scripts/exp/macros.mjs

echo "== guard: a duplicated exploit result row fails"
sed -i '2{p}' paper/data/exp/exploit-results-a.csv
if node scripts/exp/macros.mjs --check > "$OUT/err" 2>&1; then
  echo "exploit-duplicate guard did not fire"
  exit 1
fi
grep -q "duplicate measurement" "$OUT/err" || { cat "$OUT/err"; exit 1; }
cp "$OUT/expla.bak" paper/data/exp/exploit-results-a.csv

echo "== regenerate and check"
node scripts/exp/macros.mjs
node scripts/exp/macros.mjs --check

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references or overfull boxes above"
    exit 1
  fi
done

if [ -n "$(git status --porcelain paper/generated/exp-macros.tex paper/generated/exploit-verdicts.tex)" ]; then
  echo "regeneration left uncommitted output"
  exit 1
fi
for m in paper/main.tex paper/main-dmlr.tex; do
  n=$(grep -cF 'input{generated/exploit-verdicts.tex}' "$m")
  [ "$n" = "1" ] || { echo "$m inputs exploit-verdicts.tex $n times, want 1"; exit 1; }
done

MACROS=$(grep -c 'newcommand' paper/generated/exp-macros.tex)
sha256sum paper/generated/exp-macros.tex paper/generated/exploit-verdicts.tex
echo "$MACROS macros, all guards fire, both builds clean -> exp-macros, ok"
