#!/usr/bin/env bash
# End-to-end check for the Appendix J fill (issue #211): the experiment
# macros and both generated tables must be fresh, collect.mjs must not
# move review-data.tex, the appendix must carry no placeholder, no bare
# numeral, no internal E-label and no banned word, the unrun rows must
# stay unrun, and both PDFs rebuild twice with identical sha256.
# scripts/dmlr.test.sh runs last; it builds from a clean HEAD checkout,
# so run this script on a committed tree.
# See scripts/app-experiments.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

APP=paper/sections/app-experiments.tex
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

echo "== no placeholder and no bare numeral in the appendix"
if grep -niE 'placeholder|TODO' "$APP"; then
  echo "placeholder survived above"; exit 1
fi
# Strip \texttt{...} literals, p{..} column specs, the wave-N labels and
# every macro call, then no digit may remain: every count in the prose
# is a generated macro.
if sed -E -e 's/\\texttt\{[^{}]*\}//g' \
        -e 's/[a-zA-Z]?\{[0-9.]+\\textwidth\}//g' \
        -e 's/\\[a-zA-Z]+\{[^{}]*\}//g' \
        -e 's/\\[a-zA-Z]+//g' \
        -e 's/wave-[0-9]+//g' \
        -e 's/[{}\\]//g' "$APP" | grep -nE '[0-9]'; then
  echo "bare numeral above in $APP"; exit 1
fi

echo "== the unrun rows and the generated policy-only table stay unrun"
grep -qF 'never written} & none & none' "$APP" \
  || { echo "the prompt-reading tier row gained a runtime or a file"; exit 1; }
grep -qF 'did not complete} & none vendored & none' "$APP" \
  || { echo "the free-model row gained a runtime or a file"; exit 1; }
grep -qF '\input{generated/exploit-policy-only.tex}' "$APP" \
  || { echo "the policy-only table is no longer generated"; exit 1; }
want=$(grep -oE '\\expExplPolicyOnly\}\{[0-9]+\}' "$GEN/exp-macros.tex" | grep -oE '[0-9]+')
got=$(grep -cE '^r[0-9]+ &' "$GEN/exploit-policy-only.tex")
[ "$got" = "$want" ] \
  || { echo "policy-only table has $got rows, macro says $want"; exit 1; }

echo "== no internal E-labels in the appendix"
if grep -nP '\bE[1-9][ab]?\b' "$APP"; then
  echo "E-label above"; exit 1
fi

echo "== style guard on the appendix"
if grep -nP '[\x{2013}\x{2014}]|---' "$APP"; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent)\b' "$APP"; then
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
AM=$(figpage paper/main.pdf "frozen probe lists")
AD=$(figpage paper/main-dmlr.pdf "frozen probe lists")
PM=$(figpage paper/main.pdf "why no run reached it")
PD=$(figpage paper/main-dmlr.pdf "why no run reached it")
for spec in "main.pdf|$AM|app-main" "main-dmlr.pdf|$AD|app-dmlr" \
    "main.pdf|$PM|pol-main" "main-dmlr.pdf|$PD|pol-dmlr"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "appendix p$AM/p$AD, policy-only table p$PM/p$PD -> app-experiments, ok"
