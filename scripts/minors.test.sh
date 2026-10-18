#!/usr/bin/env bash
# End-to-end check for the review minors (issue #214): the check
# count, the disclosure pointer, the free-model status, the ORCID and
# the data-availability statement, then both PDFs twice with identical
# sha256 and a clean-checkout DMLR build.
# See scripts/minors.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

CON=paper/sections/conclusion.tex
CLO=paper/sections/closing.tex
PRE=paper/sections/prereg.tex
DEV=paper/sections/app-deviations.tex
REP=paper/sections/app-reproducibility.tex
MAIN=paper/main.tex
DMLR=paper/main-dmlr.tex
TOUCHED="$CON $CLO $PRE $DEV $REP $MAIN $DMLR"

echo "== the check count names four without a numeral"
grep -qF 'All but the first of the checks' "$CON" \
  || { echo "count not corrected"; exit 1; }
if grep -nF 'Three of the checks' "$CON" || grep -nF 'Four of the checks' "$CON"; then
  echo "a typed check count survived"; exit 1
fi

echo "== the disclosure names both appendices"
grep -qF 'Appendix~\ref{app:builders} counts the builders and Appendix~\ref{app:reviewstats} the reviews' "$CLO" \
  || { echo "disclosure pointer wrong"; exit 1; }

echo "== the free-model run is described as not completed"
if grep -rniE 'still running|still in progress|in progress at the time' paper/sections; then
  echo "'still running' wording survived above"; exit 1
fi
for f in "$DEV" "$CLO"; do
  grep -qF 'was not completed' "$f" || { echo "$f lacks the not-completed wording"; exit 1; }
done

echo "== the ORCID and the availability statement are present"
for f in "$MAIN" "$DMLR"; do
  grep -qF '0009-0005-9964-6841' "$f" || { echo "ORCID missing from $f"; exit 1; }
done
grep -qF 'Data availability.' "$REP" || { echo "availability heading missing"; exit 1; }
grep -qF '10.5281/zenodo.23428801' "$REP" || { echo "concept DOI missing"; exit 1; }

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
if grep -inE '\b(novel|robust|comprehensive|independent)\b' $TOUCHED \
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
CM=$(figpage paper/main.pdf "of the checks already run")
CD=$(figpage paper/main-dmlr.pdf "of the checks already run")
DM=$(figpage paper/main.pdf "Data availability")
DD=$(figpage paper/main-dmlr.pdf "Data availability")
for spec in "main.pdf|1|orcid-main" "main-dmlr.pdf|1|orcid-dmlr" \
    "main.pdf|$CM|checks-main" "main-dmlr.pdf|$CD|checks-dmlr" \
    "main.pdf|$DM|avail-main" "main-dmlr.pdf|$DD|avail-dmlr"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "checks p$CM/p$CD, availability p$DM/p$DD, ORCID p1/p1 -> minors, ok"
