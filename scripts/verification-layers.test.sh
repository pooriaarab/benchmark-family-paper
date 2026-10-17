#!/usr/bin/env bash
# End-to-end check for the verification-layers section and the F1
# redraw (C3): check the figure keeps its label and both mains input
# it, fail on undefined references or citations or a "??" in the
# extracted text, fail on a hand-typed numeral in the new prose, report
# the section's page span, render the figure pages, then build both
# PDFs a second time and prove the sha256 repeats.
# See scripts/verification-layers.failure-modes.md for what each
# check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# Orphan checks: the figure keeps \label{fig:system} and both mains
# still input the file.
grep -q 'label{fig:system}' paper/figures/fig-system.tex \
  || { echo 'fig-system.tex lost \label{fig:system}'; exit 1; }
for m in paper/main.tex paper/main-dmlr.tex; do
  grep -q 'input{figures/fig-system}' "$m" \
    || { echo "$m no longer inputs figures/fig-system"; exit 1; }
done

# A counted number typed by hand: strip comments and the structural
# gate names, then any digit left in the prose is a typed count.
digits_in_prose() { # stdin = prose; prints leftover numerals
  sed 's/%.*//; s/L[123]\b//g' | grep -oE '[0-9]+' || true
}
if [ -n "$(digits_in_prose < paper/sections/verification-layers.tex)" ]; then
  echo "verification-layers.tex: a typed numeral sits in the prose"
  exit 1
fi
# Same check on the figure's human-facing text: the caption and every
# node or edge label. Coordinates and style parameters are layout and
# carry no claim, so only brace groups at the end of a \node line and
# inline node{...}/node[...]{...} texts are read.
{
  sed -n '/\\caption{/,/\\label{fig:system}/p' paper/figures/fig-system.tex
  grep -oE '\\node[^;]*\{[^{}]*\};' paper/figures/fig-system.tex \
    | grep -oE '\{[^{}]*\};' | tr -d '{};'
  grep -oE 'node(\[[^]]*\])?\{[^{}]*\}' paper/figures/fig-system.tex \
    | grep -oE '\{[^{}]*\}$' | tr -d '{}'
} | tee "$OUT/fig-text.txt" > /dev/null
if [ -n "$(digits_in_prose < "$OUT/fig-text.txt")" ]; then
  echo "fig-system.tex: a typed numeral sits in the figure text"
  exit 1
fi

# Repeatable artifact: a fixed epoch makes tectonic output
# deterministic, so both build rounds must print the same hashes.
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
    if pdftotext "$f" - 2>/dev/null | grep -qF '??'; then
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

# Section budget: the plan gives Section 3 about 0.75 page, so report
# the real span for the reviewer.
pages=$(pdfinfo paper/main.pdf | awk '/^Pages/ {print $2}')
start=""
for i in $(seq 1 "$pages"); do
  if pdftotext -f "$i" -l "$i" paper/main.pdf - 2>/dev/null \
      | grep -q "Verification layers and the policy ladder"; then
    start=$i; break
  fi
done
[ -n "$start" ] || { echo 'section heading not found in main.pdf'; exit 1; }
end=$pages
for i in $(seq "$start" "$pages"); do
  if pdftotext -f "$i" -l "$i" paper/main.pdf - 2>/dev/null \
      | grep -q "What probing found"; then
    end=$i; break
  fi
done
echo "Verification layers spans pages $start to $end of $pages"

# Render the figure page of each PDF for visual review.
figpage() { # $1 = pdf path; prints the page holding the F1 caption
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null \
        | grep -q "findings return to the builder as fix rounds"; then
      echo "$i"; return
    fi
  done
  echo "figure caption not found in $1" >&2
  exit 1
}
MP=$(figpage paper/main.pdf)
DP=$(figpage paper/main-dmlr.pdf)
pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/f1-main"
pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/f1-dmlr"
sha256sum "$OUT"/f1-main-*.png "$OUT"/f1-dmlr-*.png
echo "verification-layers.test.sh: all checks passed -> ok"
