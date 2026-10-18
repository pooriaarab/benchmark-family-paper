#!/usr/bin/env bash
# End-to-end check for the probing-section rewrite (C4): run every
# generator --check, rebuild both PDFs twice with matching sha256,
# fail on undefined references or a "??" in the extracted text, and
# render the section pages for review.
# See scripts/probing-section.failure-modes.md for what each check
# catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
node scripts/exp/exploits-plot.mjs --check
node scripts/exp/policy-ladder.mjs --check

echo "== appendix file wired in both builds"
for m in paper/main.tex paper/main-dmlr.tex; do
  n=$(grep -cF 'input{sections/app-defect-classes.tex}' "$m")
  [ "$n" = "1" ] || { echo "$m inputs app-defect-classes.tex $n times, want 1"; exit 1; }
done
grep -q 'label{app:defectclasses}' paper/sections/app-defect-classes.tex \
  || { echo 'app-defect-classes.tex lost its label'; exit 1; }

echo "== moved detail kept its macros"
for macro in defectUnsolvableTasks noteSilentFileLeak noteHonestyAbstainMean \
    noteCrmTrapLines noteAccessUndefinedPrompts defectLexicalDetectorMiss; do
  grep -q "\\$macro" paper/sections/app-defect-classes.tex \
    || { echo "\\$macro vanished in the move"; exit 1; }
done

echo "== style guard on the edited files"
if grep -nP '[\x{2013}\x{2014}]|---' paper/sections/adversarial.tex \
    paper/sections/app-defect-classes.tex paper/sections/prereg.tex; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent)\b' \
    paper/sections/adversarial.tex paper/sections/prereg.tex; then
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

echo "== render the rewritten pages"
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
RM=$(figpage paper/main.pdf "re-measurement")
RD=$(figpage paper/main-dmlr.pdf "re-measurement")
pdftoppm -png -r 80 -f "$RM" -l "$RM" paper/main.pdf "$OUT/s4-main"
pdftoppm -png -r 80 -f "$RD" -l "$RD" paper/main-dmlr.pdf "$OUT/s4-dmlr"
sha256sum "$OUT"/s4-main-*.png "$OUT"/s4-dmlr-*.png
echo "re-measurement on pages $RM/$RD -> probing-section, ok"
