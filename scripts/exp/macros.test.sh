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
cleanup() {
  rm -f paper/sections/__exp-check-probe.tex
  cp "$OUT/reasons.bak" paper/data/exp/trivial-reasons.csv
  cp "$OUT/headroom.bak" paper/data/exp/trivial-headroom.csv
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

if [ -n "$(git status --porcelain paper/generated/exp-macros.tex)" ]; then
  echo "regeneration left uncommitted output"
  exit 1
fi

MACROS=$(grep -c 'newcommand' paper/generated/exp-macros.tex)
sha256sum paper/generated/exp-macros.tex
echo "$MACROS macros, all guards fire, both builds clean -> exp-macros, ok"
