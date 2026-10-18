#!/usr/bin/env bash
# End-to-end check for the round-4 length pass (issue #227): the nine
# cuts, the moved floats with their labels kept, the repetition rules,
# the process-detail moves, and both PDFs built twice with identical
# sha256. See scripts/r4-length.failure-modes.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
cp -r paper/generated "$OUT/generated.before"
node scripts/collect.mjs --from-json > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
diff -r "$OUT/generated.before" paper/generated \
  || { echo "collect.mjs moved generated files"; exit 1; }

echo "== the moved floats live in the appendix with their labels"
for ref in 'tab:exploit-verdicts' 'tab:trivial' 'fig:ladder'; do
  grep -q "label{$ref}" paper/sections/app-results.tex \
    || grep -q "label{$ref}" paper/generated/exploit-verdicts.tex \
    || grep -q "label{$ref}" paper/generated/trivial.tex \
    || grep -q "label{$ref}" paper/figures/fig-ladder.tex \
    || { echo "lost label $ref"; exit 1; }
done
for input in 'generated/exploit-verdicts.tex' 'generated/trivial.tex' 'figures/fig-ladder.tex'; do
  grep -q "input{$input}" paper/sections/app-results.tex \
    || { echo "$input not input in app-results"; exit 1; }
done
grep -q 'input{generated/suite-table-full.tex}' paper/main.tex \
  || { echo "full suite table not input"; exit 1; }
# and they are gone from the main matter
awk '/\\section{Introduction}/,/\\appendix/' paper/main.tex > "$OUT/mainmatter.txt" || true
sed -n '/\\section{Introduction}/,/\\input{sections\/appendix.tex}/p' paper/main.tex > "$OUT/mainmatter.txt"
for input in 'exploit-verdicts' 'trivial.tex' 'fig-ladder'; do
  if grep -q "$input" "$OUT/mainmatter.txt"; then
    echo "$input still in the main matter"; exit 1
  fi
done

echo "== the short and full suite tables are in place"
grep -q 'Package & Ver. & Tasks & Wave & Fix rounds' paper/generated/suite-table.tex \
  || { echo "short table header changed"; exit 1; }
grep -q 'Package & Ver. & Kind & Tasks & Wave & Fix rds. & Category & Data & Licence' \
  paper/generated/suite-table-full.tex \
  || { echo "full table header changed"; exit 1; }
[ "$(grep -c '&' paper/generated/suite-table.tex | head -1)" -ge 1 ] || exit 1
grep -q 'label{tab:suite-full}' paper/generated/suite-table-full.tex || exit 1

echo "== the repetition rules hold"
count() { grep -l "$1" paper/sections/intro.tex paper/sections/engine.tex paper/sections/verification-layers.tex paper/sections/adversarial.tex paper/sections/prereg.tex paper/sections/grader-soundness.tex paper/sections/related.tex paper/sections/closing.tex paper/sections/conclusion.tex paper/figures/*.tex 2>/dev/null | wc -l; }
[ "$(count 'both directions')" -le 1 ] \
  || { echo "'both directions' repeated in the main matter"; exit 1; }
# the approval coverage claim is said once outside the abstract
[ "$(count 'councilMergedApproved')" -le 1 ] \
  || { echo "the approval count repeats"; exit 1; }
[ "$(count 'councilSeverityPrsRead')" -le 1 ] \
  || { echo "the severity count repeats"; exit 1; }

echo "== the process detail moved out"
for bad in 'chair account' 'pull request \\approvalSycophancyPr' 'r\$n\$ below cites'; do
  if grep -l "$bad" paper/sections/*.tex | grep -v app- ; then
    echo "process detail remains: $bad"; exit 1
  fi
done
for cap in paper/figures/fig-heatmap.tex paper/figures/fig-ladder.tex \
    paper/figures/fig-probe-heatmap.tex paper/generated/trivial.tex \
    paper/generated/exploit-verdicts.tex; do
  if sed -n '/\\caption/,/\\label\|\\end/p' "$cap" | grep -qE '\.csv'; then
    echo "$cap: caption still names a csv"; exit 1
  fi
done

echo "== the folded text is in place"
grep -q 'Table~\\ref{tab:claimgap} gives each main claim' paper/sections/closing.tex \
  || { echo "8.1 merge missing"; exit 1; }
[ "$(grep -c 'paragraph{What the measured numbers' paper/sections/closing.tex)" = 1 ] \
  || { echo "the fold paragraph split"; exit 1; }
grep -q 'on sycophancy, was flagged by the council' paper/sections/adversarial.tex \
  || { echo "sycophancy pr reference remains"; exit 1; }
grep -q 'LLM diff review' paper/figures/fig-system.tex || { echo "L2 rename missing"; exit 1; }

echo "== build both PDFs twice with a fixed epoch"
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

echo "== the main-text page count"
reppage=$(for i in $(seq 1 20); do
  pdftotext -f "$i" -l "$i" paper/main.pdf - 2>/dev/null | grep -l '^References$' >/dev/null \
    && echo "$i" && break
done)
[ -n "$reppage" ] || { echo "References heading not found in pages 1-20"; exit 1; }
[ "$reppage" -le 12 ] || { echo "References start on page $reppage; too long"; exit 1; }
echo "references start on page $reppage"

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "length: moved floats keep labels, refs p$reppage -> r4-length, ok"
