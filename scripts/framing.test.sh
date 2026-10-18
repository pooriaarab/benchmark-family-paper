#!/usr/bin/env bash
# End-to-end check for the framing rewrite (issue #219): the
# abstract, introduction and conclusion stay inside the evidence.
# See scripts/framing.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

MAIN=paper/main.tex
DMLR=paper/main-dmlr.tex
INTRO=paper/sections/intro.tex
CONC=paper/sections/conclusion.tex
TOUCHED="$MAIN $DMLR $INTRO $CONC"
FRAMING="$MAIN $DMLR $INTRO $CONC"

echo "== the removed claims stay removed"
if grep -nE 'review depth|only running the artifact|only probing|caught almost|missed almost|almost none of it|most were found by|found by attack policies written' $FRAMING; then
  echo "an overclaim survived above"; exit 1
fi

echo "== both abstracts carry the required evidence"
for f in "$MAIN" "$DMLR"; do
  for macro in expExplFixFails expExplFixHoldsWeak expProbesCreditFailCells \
      expProbesCreditFailPkgCount expProbesForgedAccepted approvalDefectCases \
      councilMergedApproved trivialSignN expTrivialReleasedMax \
      expTrivialReleasedMaxPkgs; do
    grep -qF "\\$macro" "$f" || { echo "$f: \\$macro missing"; exit 1; }
  done
  grep -qF 'flagged a published hidden seed' "$f" \
    || { echo "$f: the council seed catch is missing"; exit 1; }
  grep -qF 'probing record never logged' "$f" \
    || { echo "$f: the payment-delegation find is missing"; exit 1; }
  grep -qF 'still fail at the shipped versions' "$f" \
    || { echo "$f: the open post-fix clauses are missing"; exit 1; }
done

echo "== the null is stated with its denominator"
for f in "$MAIN" "$DMLR" "$INTRO"; do
  grep -qF 'on \trivialSignN{} non-tied' "$f" \
    || { echo "$f: the non-tied denominator is missing"; exit 1; }
done

echo "== the two documented cases are stated against the approvals"
for f in "$MAIN" "$DMLR" "$INTRO"; do
  grep -qF '\approvalDefectCases{} of the \councilMergedApproved{}' "$f" \
    || { echo "$f: the approval-to-defect count is missing"; exit 1; }
done

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
git checkout -- paper/data/suite.json
dirty=$(git status --porcelain paper/generated)
[ -z "$dirty" ] || { echo "$dirty"; echo "collect.mjs moved generated files"; exit 1; }

echo "== style guard on the touched files"
if grep -nP '[\x{2013}\x{2014}]|---' $TOUCHED; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent|rubber.?stamp)\b' $TOUCHED \
    | grep -vi 'independent researcher'; then
  echo "banned word found above"; exit 1
fi
if grep -nF ', not ' $TOUCHED; then
  echo "'X, not Y' slogan shape above"; exit 1
fi

echo "== build both PDFs twice with a fixed epoch"
export SOURCE_DATE_EPOCH=1729000000
build_round() {
  for target in pdf dmlr; do
    make "$target" > "$OUT/$1-$target.log" 2>&1 \
      || { tail -20 "$OUT/$1-$target.log"; exit 1; }
    if grep -iE 'undefined|citation.*undefined|overfull' \
        "$OUT/$1-$target.log"; then
      echo "make $target ($1): undefined references or overfull boxes above"
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

echo "== render the changed pages"
figpage() {
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if grep -q "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null)"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2; exit 1
}
CM=$(figpage paper/main.pdf "Solvable from the model")
CD=$(figpage paper/main-dmlr.pdf "Solvable from the model")
for spec in "main.pdf|1|abstract-main" "main-dmlr.pdf|1|abstract-dmlr" \
    "main.pdf|1|intro-main" "main-dmlr.pdf|1|intro-dmlr" \
    "main.pdf|$CM|conclusion-main" "main-dmlr.pdf|$CD|conclusion-dmlr"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "abstract+intro p1, conclusion p$CM/p$CD -> framing, ok"
