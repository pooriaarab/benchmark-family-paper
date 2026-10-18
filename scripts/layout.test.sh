#!/usr/bin/env bash
# End-to-end check for the layout pass (issue #223): the scatter
# figure uses its data band, the hidden-audit counts sit inside their
# cells, the probe heatmap stays legible in grayscale, the DMLR build
# drops the false OpenReview line, cites with parentheses and keeps
# floats near their text, and both PDFs build twice with identical
# sha256. See scripts/layout.failure-modes.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

SCAT=paper/figures/fig-trivial-scatter.tex
AUD=paper/figures/fig-hidden-audit.tex
PHM=paper/figures/fig-probe-heatmap.tex
HEAT=paper/figures/fig-heatmap.tex
DMLR=paper/main-dmlr.tex
TOUCHED="$SCAT $AUD $PHM $HEAT $DMLR paper/figures/fig-exploits.tex paper/sections/closing.tex scripts/exp/probe-heatmap.mjs"

echo "== scatter uses its data band and labels stay off the axis"
grep -qF 'axis equal image' "$SCAT" \
  && { echo "axis equal image survived"; exit 1; }
grep -qF 'ymin=-0.13, ymax=0.06' "$SCAT" \
  || { echo "scatter y band not reduced"; exit 1; }
xm=$(sed -nE 's/.*xmax=([0-9.]+).*/\1/p' "$SCAT" | head -1)
awk -v x="$xm" 'BEGIN { exit !(x + 0 >= 0.55) }' \
  || { echo "xmax $xm too small for the payment-delegation label"; exit 1; }
grep -qF 'y expr=-0.025' "$SCAT" \
  || { echo "rug lane moved"; exit 1; }

echo "== hidden-audit counts are centred and the legend is attached"
grep -qF 'anchor=center' "$AUD" \
  || { echo "count nodes not centred"; exit 1; }
grep -qF 'yshift=-3pt' "$AUD" \
  || { echo "x tick labels not lowered"; exit 1; }
grep -qF 'at={(0.02,0.97)}' "$AUD" && grep -qF 'anchor=north west' "$AUD" \
  || { echo "legend not in the corner"; exit 1; }

echo "== probe heatmap stays legible in grayscale"
sha256sum paper/generated/probe-heatmap* > "$OUT/ph.before"
node scripts/exp/probe-heatmap.mjs > "$OUT/ph.log" 2>&1 \
  || { tail -20 "$OUT/ph.log"; exit 1; }
sha256sum -c "$OUT/ph.before" \
  || { echo "probe-heatmap.mjs moved its outputs; commit them"; exit 1; }
grep -qF 'north west lines, pattern color=white!80' paper/generated/probe-heatmap-hatch.tex \
  || { echo "fail-cell overlay missing from generated hatch"; exit 1; }
grep -qF 'north west lines, pattern color=white!80' "$PHM" \
  || { echo "fail legend swatch lacks the overlay"; exit 1; }

echo "== fig 2 caption explains the dashed wave rule"
grep -qF 'dashed rule separates the waves' "$HEAT" \
  || { echo "wave rule not explained"; exit 1; }

echo "== dmlr template fixes are wired"
if grep -nE 'def\\openreview|Reviewed on OpenReview' "$DMLR"; then
  echo "openreview claim survived"; exit 1
fi
grep -qF 'def\@maketitle' "$DMLR" \
  || { echo "maketitle override missing"; exit 1; }
grep -qF '\let\cite\citep' "$DMLR" \
  || { echo "cite not routed to citep"; exit 1; }
[ "$(grep -c 'FloatBarrier' "$DMLR")" -ge 5 ] \
  || { echo "float barriers missing"; exit 1; }

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
    if grep -iE 'undefined|citation.*undefined|overfull|Float too large' \
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

echo "== dmlr text claims no review and cites with parentheses"
dtext=$(pdftotext paper/main-dmlr.pdf - 2>/dev/null | tr -s '[:space:]' ' ')
if grep -qi 'Reviewed on OpenReview' <<< "$dtext"; then
  echo "OpenReview review claim still prints"; exit 1
fi
grep -qE '\((Reuel|Skalse|Bean|Sainz|Dehghani|Zhu) et al\.' <<< "$dtext" \
  || { echo "no parenthesised citation found in the DMLR build"; exit 1; }

echo "== render the changed pages"
figpage() {
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if grep -q "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null \
        | tr -s '[:space:]' ' ')"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2; exit 1
}
SM=$(figpage paper/main.pdf "outside the registered comparison")
SD=$(figpage paper/main-dmlr.pdf "outside the registered comparison")
HM=$(figpage paper/main.pdf "Hidden-split hygiene")
HD=$(figpage paper/main-dmlr.pdf "Hidden-split hygiene")
PM=$(figpage paper/main.pdf "genuine fails in black")
PD=$(figpage paper/main-dmlr.pdf "genuine fails in black")
for spec in "main.pdf|$SM|scatter" "main-dmlr.pdf|$SD|scatter" \
    "main.pdf|$HM|audit" "main-dmlr.pdf|$HD|audit" \
    "main.pdf|$PM|probes" "main-dmlr.pdf|$PD|probes" \
    "main-dmlr.pdf|1|dmlr-front"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "scatter p$SM/p$SD, audit p$HM/p$HD, probes p$PM/p$PD -> layout, ok"
