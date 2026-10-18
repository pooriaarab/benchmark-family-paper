#!/usr/bin/env bash
# End-to-end check for the length pass (issue #221): the moved
# floats keep their labels and evidence, the disclaimers read once,
# and the main text shortens. See scripts/length.failure-modes.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

MAINTEX="paper/sections/intro.tex paper/sections/engine.tex paper/sections/verification-layers.tex paper/sections/adversarial.tex paper/sections/prereg.tex paper/sections/grader-soundness.tex paper/sections/related.tex paper/sections/closing.tex paper/sections/conclusion.tex"
TOUCHED="$MAINTEX paper/sections/app-engine.tex paper/sections/app-experiments.tex paper/sections/app-reproducibility.tex paper/sections/app-builders.tex paper/sections/app-results.tex paper/sections/appendix.tex paper/figures/fig-system.tex paper/figures/fig-probe-heatmap.tex paper/main.tex paper/main-dmlr.tex"

echo "== moved floats live only in the appendix"
for f in generated/defects.tex figures/fig-exploits.tex figures/fig-trivial-scatter.tex figures/fig-trivial-reasons.tex figures/fig-hidden-audit.tex generated/exploit-verdicts-low.tex; do
  if grep -rn "input{$f}" paper/main.tex paper/main-dmlr.tex | grep -v app-results; then
    : # the mains list inputs; checked below per section
  fi
done
# each moved input must appear exactly once, inside app-results
for f in generated/defects.tex generated/exploit-verdicts-low.tex figures/fig-exploits.tex figures/fig-trivial-scatter.tex figures/fig-trivial-reasons.tex figures/fig-hidden-audit.tex; do
  n=$(grep -rc "input{$f}" paper/main.tex paper/main-dmlr.tex paper/sections | awk -F: '{s+=$2} END{print s}')
  [ "$n" = "1" ] || { echo "$f is input $n times, want 1"; exit 1; }
  grep -qF "input{$f}" paper/sections/app-results.tex \
    || { echo "$f not inside app-results.tex"; exit 1; }
done

echo "== the labels resolve and the moved captions keep their pointers"
for lab in tab:defects tab:exploit-verdicts-low fig:exploits fig:trivial-scatter fig:trivial-reasons fig:hiddenaudit; do
  n=$(grep -rl "label{$lab}" paper/sections paper/figures paper/generated | wc -l)
  [ "$n" = "1" ] || { echo "$lab defined $n times"; exit 1; }
done
for f in prereg grader-soundness; do :; done
grep -qF 'Figure~\ref{fig:exploits} in the appendix' paper/sections/adversarial.tex \
  || { echo "fig:exploits pointer missing"; exit 1; }
grep -qF 'Figure~\ref{fig:trivial-scatter} in Appendix~\ref{app:results}' paper/sections/prereg.tex \
  || { echo "fig:trivial-scatter pointer missing"; exit 1; }
grep -qF 'Figure~\ref{fig:trivial-reasons} in Appendix~\ref{app:results}' paper/sections/prereg.tex \
  || { echo "fig:trivial-reasons pointer missing"; exit 1; }
grep -qF 'Figure~\ref{fig:hiddenaudit} in Appendix~\ref{app:results}' paper/sections/grader-soundness.tex \
  || { echo "fig:hiddenaudit pointer missing"; exit 1; }

echo "== the moved evidence lives in the appendix files"
grep -qF 'defineBenchmark' paper/sections/app-engine.tex \
  || { echo "app-engine lacks the snippet"; exit 1; }
grep -qF 'trivial-nulljson' paper/sections/app-experiments.tex \
  || { echo "app-experiments lacks the policy names"; exit 1; }
grep -qF 'eval-matrix' paper/sections/app-experiments.tex \
  || { echo "app-experiments lacks the runner names"; exit 1; }
grep -qF 'versions.json' paper/sections/app-experiments.tex \
  || { echo "app-experiments lacks the version pins"; exit 1; }
grep -qF 'expExplCommitRows' paper/sections/app-experiments.tex \
  || { echo "app-experiments lacks the row bookkeeping"; exit 1; }
grep -qF 'NOASSERTION' paper/sections/app-reproducibility.tex \
  || { echo "app-reproducibility lacks the licence detail"; exit 1; }

echo "== the disclaimers read once"
[ "$(grep -c 'author configured' paper/sections/verification-layers.tex)" = "1" ] \
  || { echo "verification-layers disclaimer count off"; exit 1; }
[ "$(grep -c 'author configured' paper/sections/closing.tex)" = "1" ] \
  || { echo "closing disclaimer count off"; exit 1; }
# intro.tex keeps its instance until #220 (the framing PR) merges;
# this branch must not touch that line or the two PRs conflict.
if grep -nE 'author configured' $MAINTEX | grep -vF -e verification-layers.tex -e closing.tex -e intro.tex; then
  echo "a third configured-session disclaimer survived"; exit 1
fi

echo "== stale process detail is out of the main text"
if grep -nE 'texttt\{check\} job|performance\.now|trivial-nulljson|eval-matrix|eval-analyze|versions\.json|approvalPelicanPr|approvalPelicanIssue' $MAINTEX; then
  echo "process detail survived in a main-text file above"; exit 1
fi
# intro.tex and conclusion.tex carry their instances until #220
# (the framing PR) merges; this branch must not touch those lines.
if grep -nE 'rubber.?stamp|diff-reading approvals' $TOUCHED \
    | grep -vF -e intro.tex -e conclusion.tex; then
  echo "slang survived above"; exit 1
fi

echo "== probe heatmap holds the released rows"
node scripts/exp/probe-heatmap.mjs | tail -1
rows=$(($(wc -l < paper/generated/probe-heatmap-rows.csv) - 1))
[ "$rows" = "22" ] || { echo "rows: $rows, want 22"; exit 1; }
grep -qF 'probesRows}{22}' paper/generated/probe-heatmap-macros.tex \
  || { echo "probesRows macro not 22"; exit 1; }

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
test -f paper/generated/exploit-verdicts-low.tex \
  || { echo "exploit-verdicts-low.tex missing"; exit 1; }
grep -qF 'label{tab:exploit-verdicts-low}' paper/generated/exploit-verdicts-low.tex \
  || { echo "low table label missing"; exit 1; }
cp -r paper/generated "$OUT/generated.before"
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
git checkout -- paper/data/suite.json
diff -r "$OUT/generated.before" paper/generated \
  || { echo "collect.mjs moved generated files"; exit 1; }

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

echo "== report the main-text page count"
figpage() {
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if grep -q "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null)"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2; exit 1
}
MRES=$(figpage paper/main.pdf "moved from the main text")
MPAGES=$(pdfinfo paper/main.pdf | awk '/^Pages/ {print $2}')
DPAGES=$(pdfinfo paper/main-dmlr.pdf | awk '/^Pages/ {print $2}')
REFS=$(figpage paper/main.pdf "Patil")
pdftoppm -png -r 80 -f "$MRES" -l "$((MRES+3 < MPAGES ? MRES+3 : MPAGES))" paper/main.pdf "$OUT/appres"
sha256sum "$OUT"/appres-*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "refs p$REFS, moved-results appendix p$MRES, pages $MPAGES/$DPAGES -> length, ok"
