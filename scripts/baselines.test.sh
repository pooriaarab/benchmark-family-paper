#!/usr/bin/env bash
# End-to-end check for the baseline-section rewrite (C5): the floats
# keep their labels and are input once, the macros --check passes, the
# prose carries no hand-typed numeral, the F4 placeholder comment is
# the only ladder mention, both PDFs build clean and the sha256 of each
# repeats on a second build. See scripts/baselines.failure-modes.md
# for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

SECTION=paper/sections/prereg.tex

# Float wiring: mains input the section and table; the two figures
# moved to the results appendix (review M5) and stay input once.
for m in paper/main.tex paper/main-dmlr.tex; do
  for f in sections/prereg.tex generated/trivial.tex; do
    n=$(grep -cF "input{$f}" "$m")
    [ "$n" = "1" ] || { echo "$m inputs $f $n times, want 1"; exit 1; }
  done
done
for f in figures/fig-trivial-scatter.tex figures/fig-trivial-reasons.tex; do
  n=$(grep -rcF "input{$f}" paper/main.tex paper/main-dmlr.tex paper/sections \
      | awk -F: '{s+=$2} END{print s}')
  [ "$n" = "1" ] || { echo "$f is input $n times, want 1"; exit 1; }
  grep -qF "input{$f}" paper/sections/app-results.tex \
    || { echo "$f not inside app-results.tex"; exit 1; }
done
grep -q 'label{tab:trivial}' paper/generated/trivial.tex \
  || { echo 'generated/trivial.tex lost \label{tab:trivial}'; exit 1; }
grep -q 'label{fig:trivial-scatter}' paper/figures/fig-trivial-scatter.tex \
  || { echo 'fig-trivial-scatter.tex lost its label'; exit 1; }
grep -q 'label{fig:trivial-reasons}' paper/figures/fig-trivial-reasons.tex \
  || { echo 'fig-trivial-reasons.tex lost its label'; exit 1; }

# The F4 ladder has no data yet: exactly one placeholder comment and no
# live reference to a ladder figure anywhere in the paper sources.
grep -q 'Placeholder placement for figure F4' "$SECTION" \
  || { echo 'prereg.tex lost the F4 placeholder comment'; exit 1; }
if grep -rniE 'ref{fig:(policy-)?ladder}|input{[^}]*ladder' paper/; then
  echo 'a live ladder reference or input exists; F4 has no merged data'
  exit 1
fi

# A counted number typed by hand: strip comments, \texttt groups (the
# DOIs live there), ISO dates, version tokens and the designators the
# prose is allowed to name; any numeral left is a typed measurement.
digits_in_prose() { # stdin = prose; prints leftover numerals
  sed 's/%.*//' \
    | sed 's/\\texttt{[^{}]*}//g' \
    | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}//g; s/0\.[12]\.0//g' \
    | sed 's/\b[HEFDLT][0-9]\{1,2\}b\{0,1\}\b//g; s/wave-[0-9]//g' \
    | grep -oE '[0-9]+' || true
}
leftover=$(digits_in_prose < "$SECTION")
if [ -n "$leftover" ]; then
  echo "prereg.tex: a typed numeral sits in the prose: $(echo "$leftover" | tr '\n' ' ')"
  exit 1
fi

# Every \exp* name in the text must be generated and the committed file
# fresh.
node scripts/exp/macros.mjs --check

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
    # Drain pdftotext before grep: grep -q can exit on an early match
    # and SIGPIPE the extractor, which pipefail would read as a pass.
    # The ?? filter drops the nullish operator in the engine.tex
    # verbatim listing (submission.answer ?? ""), not a broken ref.
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

# Section budget: the plan gives Section 5 about 1.5 pages, so report
# the real span for the reviewer. page_has drains pdftotext fully
# before grep runs: piping into grep -q races under pipefail because
# an early match can SIGPIPE the extractor.
page_has() { # $1 = pdf, $2 = page, $3 = pattern
  local text
  text=$(pdftotext -f "$2" -l "$2" "$1" - 2>/dev/null)
  grep -q "$3" <<< "$text"
}
pages=$(pdfinfo paper/main.pdf | awk '/^Pages/ {print $2}')
start=""
for i in $(seq 1 "$pages"); do
  if page_has paper/main.pdf "$i" "Do generic baselines catch it"; then
    start=$i; break
  fi
done
[ -n "$start" ] || { echo 'section heading not found in main.pdf'; exit 1; }
end=$pages
for i in $(seq $((start + 1)) "$pages"); do
  if page_has paper/main.pdf "$i" "Are the shipped graders sound now"; then
    end=$i; break
  fi
done
echo "Baseline section spans pages $start to $end of $pages"

# Render the figure pages of each PDF for visual review.
figpage() { # $1 = pdf path, $2 = caption needle; prints the page
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if page_has "$1" "$i" "$2"; then
      echo "$i"; return
    fi
  done
  echo "caption '$2' not found in $1" >&2
  exit 1
}
for spec in "main.pdf|scatter|outside the registered comparison" \
            "main.pdf|reasons|share of zero-score rows" \
            "main-dmlr.pdf|scatter|outside the registered comparison" \
            "main-dmlr.pdf|reasons|share of zero-score rows"; do
  pdf=${spec%%|*}; rest=${spec#*|}
  tag=${rest%%|*}; needle=${rest#*|}
  pg=$(figpage "paper/$pdf" "$needle")
  pdftoppm -png -r 80 -f "$pg" -l "$pg" "paper/$pdf" "$OUT/$tag-$pdf"
done
sha256sum "$OUT"/*.png
echo "baselines.test.sh: all checks passed -> ok"
