#!/usr/bin/env bash
# End-to-end check for the C8 rewrite (title, abstract, intro,
# conclusion): the title still matches the data, the abstract fits the
# arXiv limit and carries no PR or council mechanics, the two mains
# hold the same abstract, the Willison credit lives in the appendix,
# the conclusion keeps five checks and drops the council-count recap,
# the prose carries no hand-typed numeral or banned pattern, and both
# PDFs build clean twice with matching sha256.
# See scripts/title-abstract.failure-modes.md for what each check
# catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

echo "== title still matches the suite size"
for m in paper/main.tex paper/main-dmlr.tex; do
  grep -q 'Cases}' "$m" || { echo "$m: title lost the case count"; exit 1; }
  grep -q '\\suitePackages' "$m" \
    || { echo "$m: title lost the suitePackages macro"; exit 1; }
done
grep -q 'newcommand{\\suitePackages}{22}' paper/generated/macros.tex \
  || { echo 'suitePackages is not 22; the title must change with it'; exit 1; }

echo "== abstracts identical across the two mains"
abstract_body() { # $1 = main file; strips the begin/end lines
  awk '/\\begin\{abstract\}/{f=1;next} /\\end\{abstract\}/{f=0} f' "$1" \
    | tr -s '[:space:]' ' '
}
abstract_body paper/main.tex > "$OUT/abs-main"
abstract_body paper/main-dmlr.tex > "$OUT/abs-dmlr"
diff "$OUT/abs-main" "$OUT/abs-dmlr" \
  || { echo 'the two abstracts differ'; exit 1; }
cp "$OUT/abs-main" "$OUT/abs-check"

echo "== abstract fits the arXiv limit after macro expansion"
expand_macros() { # stdin = tex source; expands generated \newcommand macros
  local text; text=$(cat)
  while IFS= read -r name; do
    val=$(grep -rh "\\\\newcommand{\\\\$name}" paper/generated/ \
      | sed -n 's/.*{\(.*\)}$/\1/p' | head -1)
    [ -n "$val" ] || { echo "macro \\$name unresolved" >&2; exit 1; }
    text=${text//\\$name\{\}/$val}
    text=${text//\\$name/$val}
  done < <(grep -oE '\\[a-zA-Z]+' <<< "$text" | sed 's/^\\//' | sort -u)
  echo "$text"
}
rendered=$(expand_macros < "$OUT/abs-check" | tr -d '\\{}$~')
chars=$(wc -m <<< "$rendered")
[ "$chars" -le 1920 ] \
  || { echo "abstract renders to $chars chars, over the 1920 limit"; exit 1; }
echo "abstract renders to $chars chars"
echo "$rendered" > "$OUT/abs-rendered"

echo "== no PR or council mechanics in the abstract"
if grep -inE 'council|chair|timed out|issue [0-9]|pull request [0-9]|pull requests [0-9]|#[0-9]|commit [0-9a-f]' \
    "$OUT/abs-rendered"; then
  echo "review mechanics leaked into the abstract, above"; exit 1
fi

echo "== the headline numbers are macros, not literals"
if sed 's/wave-[0-9]//g' "$OUT/abs-main" | grep -nE '[0-9]'; then
  echo "a numeral sits in the abstract source, above"; exit 1
fi

echo "== Willison credit moved to the appendix"
if grep -q 'willison2024pelican' paper/sections/intro.tex; then
  echo 'intro.tex still cites willison2024pelican'; exit 1
fi
grep -q 'willison2024pelican' paper/sections/app-graders.tex \
  || { echo 'app-graders.tex lost the Willison citation'; exit 1; }

echo "== conclusion: five checks, scripted runtimes, no council recap"
n=$(grep -c '\\item' paper/sections/conclusion.tex)
[ "$n" = "5" ] || { echo "conclusion lists $n checks, want 5"; exit 1; }
for frag in expRuntimeBatteryMin expRuntimeProbesSec; do
  grep -q "\\$frag" paper/sections/conclusion.tex \
    || { echo "conclusion lost the runtime macro \\$frag"; exit 1; }
done
if grep -nE '\\council|\\approvalDefect|\\reviewRounds|\\buildersPrs' \
    paper/sections/conclusion.tex; then
  echo 'council bookkeeping returned to the conclusion, above'; exit 1
fi

echo "== style guard on the edited prose"
if grep -nP '[\x{2013}\x{2014}]|---' paper/sections/intro.tex \
    paper/sections/conclusion.tex "$OUT/abs-main"; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent)\b' \
    paper/sections/intro.tex paper/sections/conclusion.tex "$OUT/abs-main"; then
  echo "banned word found above"; exit 1
fi

echo "== no hand-typed numeral in the edited prose"
digits_in_prose() { # stdin = prose; prints leftover numerals
  sed 's/%.*//' \
    | sed 's/\\texttt{[^{}]*}//g' \
    | sed 's/\\cite{[^{}]*}//g; s/\\ref{[^{}]*}//g; s/\\label{[^{}]*}//g' \
    | sed 's/\\url{[^{}]*}//g; s/\\path{[^{}]*}//g' \
    | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}//g; s/0\.[12]\.0//g' \
    | sed 's/\b[HEFDLT][0-9]\{1,2\}b\{0,1\}\b//g; s/wave-[0-9]//g' \
    | grep -oE '[0-9]+' || true
}
for f in paper/sections/intro.tex paper/sections/conclusion.tex "$OUT/abs-main"; do
  leftover=$(digits_in_prose < "$f")
  if [ -n "$leftover" ]; then
    echo "$f: a typed numeral sits in the prose: $(echo "$leftover" | tr '\n' ' ')"
    exit 1
  fi
done

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
node scripts/exp/exploits-plot.mjs --check
node scripts/exp/policy-ladder.mjs --check

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
    # Drain pdftotext before grep: grep -q exiting early would SIGPIPE
    # the extractor and pipefail would read the match as a miss.
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

echo "== render the first page and the conclusion page of each build"
secpage() { # $1 = pdf path, $2 = unique text fragment
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    # Collapse whitespace: a phrase can wrap across lines.
    if grep -qF "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null \
        | tr -s '[:space:]' ' ')"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2
  exit 1
}
CM=$(secpage paper/main.pdf "still ship a broken grader")
CD=$(secpage paper/main-dmlr.pdf "still ship a broken grader")
pdftoppm -png -r 80 -f 1 -l 1 paper/main.pdf "$OUT/front-main"
pdftoppm -png -r 80 -f 1 -l 1 paper/main-dmlr.pdf "$OUT/front-dmlr"
pdftoppm -png -r 80 -f "$CM" -l "$CM" paper/main.pdf "$OUT/conclusion-main"
pdftoppm -png -r 80 -f "$CD" -l "$CD" paper/main-dmlr.pdf "$OUT/conclusion-dmlr"
sha256sum "$OUT"/front-main-*.png "$OUT"/front-dmlr-*.png \
  "$OUT"/conclusion-main-*.png "$OUT"/conclusion-dmlr-*.png
echo "abstract $chars chars; conclusion on pages $CM/$CD -> title-abstract, ok"
