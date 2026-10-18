#!/usr/bin/env bash
# End-to-end check for the Section 4 wording fixes (issue #208): every
# experiment generator --check must be clean, collect.mjs must not move
# review-data.tex, the edited files must not carry the old claims, the
# hard-typed literals or an internal E-label, T3 must show the honest
# re-check, and both PDFs rebuild twice with identical sha256.
# scripts/dmlr.test.sh runs last; it builds from a clean HEAD checkout,
# so run this script on a committed tree.
# See scripts/s4-wording.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

S4=paper/sections/adversarial.tex
ADC=paper/sections/app-defect-classes.tex
GEN=paper/generated

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
node scripts/exp/exploits-plot.mjs --check
node scripts/exp/policy-ladder.mjs --check
sha256sum "$GEN/review-data.tex" > "$OUT/rw.before"
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
sha256sum -c "$OUT/rw.before" \
  || { echo "collect.mjs moved review-data.tex; commit the regenerated file"; exit 1; }

echo "== the old claims and literals are gone"
for pat in 'shipped tarballs' 'published artifacts' 'shipped artifacts' \
    'still gives the exploit credit' 'rather than explained away' \
    'real and mostly fixed' 'builderAgents' 'builderTopAgent'; do
  if grep -nF "$pat" "$S4"; then
    echo "stale phrasing above in $S4"; exit 1
  fi
done
for pat in 'two ticket tasks' '0.250' 'ten more READMEs' 'a mean of 1' \
    'EVALUATOR\_POOL\_SIZE = 4' '52 percent' '0.35'; do
  if grep -nF "$pat" "$ADC"; then
    echo "hard-typed number above in $ADC"; exit 1
  fi
done

echo "== no internal E-labels and no stale mark wording"
if grep -rnP '\bE[1-6]\b' paper/sections paper/figures; then
  echo "E-label above"; exit 1
fi
if grep -rn 'no E2 row' paper/; then
  echo "'no E2 row' survived above"; exit 1
fi
nd=$(grep -c 'no attack row' "$GEN/policy-ladder-stems.tex")
[ "$nd" -gt 0 ] || { echo "no 'no attack row' marks in the ladder stems"; exit 1; }

echo "== T3 keeps the honest re-check in its lower block"
grep -qF 'equals oracle' "$GEN/exploit-verdicts.tex" \
  || { echo "T3 lost the equals-oracle wording"; exit 1; }
grep -qF 'fix fails (honest)' "$GEN/exploit-verdicts-low.tex" \
  || { echo "the low block does not mark the honest re-check row"; exit 1; }
grep -qF '& vs &' "$GEN/exploit-verdicts-low.tex" \
  || { echo "the low block lost the vs column header"; exit 1; }
grep -qF 'fix fails (honest) & 0.2.0 & oracle' "$GEN/exploit-verdicts-low.tex" \
  || { echo "the low block does not show the honest row compares against the oracle"; exit 1; }
grep -q 'pinned commits' "$S4" \
  || { echo "$S4 lost the commit-artifact split"; exit 1; }

echo "== required macros are used in the rewritten text"
for m in expExplReplCommit expExplFixFailsAttackPkgs expExplFixFailsHonestPkgs \
    expExplAtkMedianOldPaired expExplAtkMedianNewPaired expExplAtkPairs \
    expExplNotReplicatedList defectScoreMaterial defectNoClassPackages; do
  grep -q "\\$m" "$S4" || { echo "\\$m missing from $S4"; exit 1; }
done
for m in expExplReleasedRows expExplCommitRows expExplNotReplCommit \
    expExplFixHoldsWeak; do
  grep -q "\\$m" paper/sections/app-experiments.tex \
    || { echo "\\$m missing from app-experiments.tex"; exit 1; }
done
for m in noteSilentTicketTasks noteHiddenSeedReadmes noteApologyForgedMean \
    noteTestWeakeningPoolSize noteTestWeakeningPoolLine noteCrmDocHonestPct \
    notePelicanBeakMin expTrivCheckoutConsentOld expTrivCheckoutConsentNew; do
  grep -q "\\$m" "$ADC" || { echo "\\$m missing from $ADC"; exit 1; }
done
grep -q 'builderTopAgent' paper/sections/app-builders.tex \
  || { echo "builder naming did not land in the appendix"; exit 1; }

echo "== style guard on the edited files"
if grep -nP '[\x{2013}\x{2014}]|---' "$S4" "$ADC" paper/sections/prereg.tex \
    paper/sections/app-builders.tex paper/figures/fig-ladder.tex \
    paper/figures/fig-trivial-scatter.tex; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent)\b' \
    "$S4" "$ADC" paper/sections/prereg.tex paper/sections/app-builders.tex; then
  echo "banned word found above"; exit 1
fi

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

echo "== render the changed pages"
figpage() { # $1 = pdf path, $2 = unique text fragment
  # Command substitution, not a pipe: grep -q exiting early would
  # SIGPIPE pdftotext and pipefail would read a match as a miss.
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if grep -q "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null)"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2
  exit 1
}
RM=$(figpage paper/main.pdf "stop-one-step-early")
RD=$(figpage paper/main-dmlr.pdf "stop-one-step-early")
T3M=$(figpage paper/main.pdf "equals oracle")
T3D=$(figpage paper/main-dmlr.pdf "equals oracle")
LM=$(figpage paper/main.pdf "no attack row")
LD=$(figpage paper/main-dmlr.pdf "no attack row")
for spec in "main.pdf|$RM|s4-main" "main-dmlr.pdf|$RD|s4-dmlr" \
    "main.pdf|$T3M|t3-main" "main-dmlr.pdf|$T3D|t3-dmlr" \
    "main.pdf|$LM|lad-main" "main-dmlr.pdf|$LD|lad-dmlr"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "re-measurement p$RM/p$RD, T3 p$T3M/p$T3D, ladder p$LM/p$LD -> s4-wording, ok"
