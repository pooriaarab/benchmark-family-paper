#!/usr/bin/env bash
# End-to-end check for the grader soundness section (C6): the macro
# file must be fresh and cover every \exp* use, collect.mjs must show
# no diff except collectedAt, the F7/F8 placeholders must be gone with
# both figures still input and labelled, the section prose must carry
# no hand-typed numeral and no banned wording, both PDFs must build
# clean twice under a fixed epoch with identical sha256, and the
# figure pages are rendered for review.
# See scripts/grader-soundness.failure-modes.md for what each check
# catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

SECTION=paper/sections/grader-soundness.tex

# The generated macro file covers every \exp* use and matches the CSVs.
node scripts/exp/macros.mjs --check

# collect.mjs regenerates generated/* identically; suite.json may move
# only on its collectedAt timestamp.
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
if [ -n "$(git status --porcelain paper/generated/)" ]; then
  echo "collect.mjs changed generated files beyond exp-macros sources"
  git status --porcelain paper/generated/
  exit 1
fi
if git diff -- paper/data/suite.json | grep -E '^[+-]' \
    | grep -vE '^(\+\+\+|---)|collectedAt' | grep .; then
  echo "collect.mjs changed suite.json beyond collectedAt"
  exit 1
fi

# Placeholder comments gone; both mains still input the two figures;
# both labels survive; the section references them.
for m in paper/main.tex paper/main-dmlr.tex; do
  if grep -nE "Placeholder placement for figure (F7|F8)" "$m"; then
    echo "$m still carries an F7/F8 placeholder comment"
    exit 1
  fi
  grep -q "input{figures/fig-probe-heatmap" "$m" \
    || { echo "$m no longer inputs figures/fig-probe-heatmap"; exit 1; }
done
# F8 moved to the results appendix (issue #221, M5): input exactly once
# across the tree, and that once lives inside app-results.tex.
n=$(grep -rcF 'input{figures/fig-hidden-audit.tex}' paper/main.tex \
    paper/main-dmlr.tex paper/sections | awk -F: '{s+=$2} END{print s}')
[ "$n" = "1" ] || { echo "fig-hidden-audit is input $n times, want 1"; exit 1; }
grep -qF 'input{figures/fig-hidden-audit.tex}' paper/sections/app-results.tex \
  || { echo 'fig-hidden-audit not inside app-results.tex'; exit 1; }
grep -q 'label{fig:probes}' paper/figures/fig-probe-heatmap.tex \
  || { echo 'fig-probe-heatmap.tex lost \label{fig:probes}'; exit 1; }
grep -q 'label{fig:hiddenaudit}' paper/figures/fig-hidden-audit.tex \
  || { echo 'fig-hidden-audit.tex lost \label{fig:hiddenaudit}'; exit 1; }
for ref in 'fig:probes' 'fig:hiddenaudit'; do
  grep -q "ref{$ref}" "$SECTION" \
    || { echo "$SECTION never cites $ref"; exit 1; }
done

# A counted number typed by hand: strip comments, \texttt{...} names
# and pinned-version literals (artifact identifiers, not
# measurements), then any numeral left in the prose is a typed count.
digits_in_prose() { # stdin = prose; prints leftover numerals
  sed 's/%.*//' \
    | sed 's/\\texttt{[^{}]*}//g; s/\\allowbreak//g' \
    | sed 's/[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*//g' \
    | grep -oE '[0-9]+' || true
}
if [ -n "$(digits_in_prose < "$SECTION")" ]; then
  echo "$SECTION: a typed numeral sits in the prose"
  exit 1
fi

# Banned prose: em dash, the "X, not Y" slogan shape, and the words the
# humanizer rules forbid.
if grep -n '—' "$SECTION"; then echo "$SECTION: em dash"; exit 1; fi
if grep -nE ', not ' "$SECTION"; then
  echo "$SECTION: slogan shape ', not '"
  exit 1
fi
if grep -niE '\b(independent|novel|robust|comprehensive|first)\b' "$SECTION"; then
  echo "$SECTION: banned word above"
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
    # Drain pdftotext before grep: grep -q can exit on an early match
    # and SIGPIPE the extractor, which pipefail would read as a pass.
    # The ?? filter drops the nullish operator in the engine.tex
    # verbatim listing (submission.answer ?? ""), which is not a
    # broken reference.
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

# Section budget: the plan gives Section 6 about 1.5 pages, so report
# the real span for the reviewer. page_has drains pdftotext fully
# before grep runs: piping into grep -q races under pipefail because
# an early match can SIGPIPE the extractor.
page_has() { # $1 = pdf, $2 = page, $3 = pattern
  local text
  # Collapse whitespace: a phrase can wrap across pdftotext lines.
  text=$(pdftotext -f "$2" -l "$2" "$1" - 2>/dev/null | tr -s '[:space:]' ' ')
  grep -q "$3" <<< "$text"
}
pages=$(pdfinfo paper/main.pdf | awk '/^Pages/ {print $2}')
start=""
for i in $(seq 1 "$pages"); do
  if page_has paper/main.pdf "$i" "shipped graders sound now"; then
    start=$i; break
  fi
done
[ -n "$start" ] || { echo 'section heading not found in main.pdf'; exit 1; }
end=$pages
for i in $(seq "$start" "$pages"); do
  if page_has paper/main.pdf "$i" "Related work"; then
    end=$i; break
  fi
done
echo "Grader soundness spans pages $start to $end of $pages"

# Render the figure page of each PDF for visual review.
figpage() { # $1 = pdf path, $2 = caption fragment; prints the page
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if page_has "$1" "$i" "$2"; then
      echo "$i"; return
    fi
  done
  echo "caption '$2' not found in $1" >&2
  exit 1
}
for pair in 'Contract probes at each:f7' 'Hidden-split hygiene on the:f8'; do
  frag=${pair%%:*}; tag=${pair##*:}
  MP=$(figpage paper/main.pdf "$frag")
  DP=$(figpage paper/main-dmlr.pdf "$frag")
  pdftoppm -png -r 80 -f "$MP" -l "$MP" paper/main.pdf "$OUT/$tag-main"
  pdftoppm -png -r 80 -f "$DP" -l "$DP" paper/main-dmlr.pdf "$OUT/$tag-dmlr"
done
sha256sum "$OUT"/*.png
echo "grader-soundness.test.sh: all checks passed -> ok"
