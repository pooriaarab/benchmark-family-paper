#!/usr/bin/env bash
# End-to-end check for the limitations rewrite (C7): the claim table
# names a real data file per row, the required caveats are present, the
# prose carries no hand-typed numeral or banned pattern, both PDFs
# build clean twice with matching sha256, and the limitations page is
# rendered for review. See scripts/limitations.failure-modes.md for
# what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

SECTION=paper/sections/closing.tex

echo "== float wiring: one input per main, label kept"
for m in paper/main.tex paper/main-dmlr.tex; do
  n=$(grep -cF 'input{sections/closing.tex}' "$m")
  [ "$n" = "1" ] || { echo "$m inputs closing.tex $n times, want 1"; exit 1; }
done
grep -q 'label{tab:claimgap}' "$SECTION" \
  || { echo 'closing.tex lost \label{tab:claimgap}'; exit 1; }
grep -q 'Data file' "$SECTION" \
  || { echo 'claim table lost the data-file column'; exit 1; }

echo "== required caveats present"
for frag in "human-built control" "author configured" \
    "partly true by construction" "exploratory" \
    "unreleased policy" "unfinished" "no human reviewer" \
    "not in this repository"; do
  grep -qF "$frag" "$SECTION" \
    || { echo "closing.tex is missing the caveat fragment: $frag"; exit 1; }
done

echo "== every data file named in the table exists in the repo"
while IFS= read -r name; do
  case "$name" in
    *\**) # a wildcarded name resolves through a glob
      compgen -G "$ROOT/paper/data/exp/$name" > /dev/null \
        || compgen -G "$ROOT/paper/data/$name" > /dev/null \
        || { echo "no file matches $name"; exit 1; } ;;
    *) find "$ROOT" -name "$name" -print -quit | grep -q . \
        || { echo "no file named $name in the repository"; exit 1; } ;;
  esac
done < <(sed 's/}-\\allowbreak\\texttt{/-/g' "$SECTION" \
         | grep -oE '\\texttt\{[^{}]*\.(csv|json|jsonl)\}' \
         | sed 's/\\texttt{//; s/}//')

echo "== style guard on the edited file"
if grep -nP '[\x{2013}\x{2014}]|---' "$SECTION"; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent)\b' "$SECTION"; then
  echo "banned word found above"; exit 1
fi

echo "== no hand-typed numeral in the prose"
digits_in_prose() { # stdin = prose; prints leftover numerals
  sed 's/%.*//' \
    | sed 's/\\texttt{[^{}]*}//g' \
    | sed 's/{0\.[0-9]*\\textwidth}//g; s/CC BY 4\.0//g; s/CC0//g; s/CC-BY//g' \
    | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}//g; s/0\.[12]\.0//g' \
    | sed 's/\b[HEFDLT][0-9]\{1,2\}b\{0,1\}\b//g; s/wave-[0-9]//g' \
    | grep -oE '[0-9]+' || true
}
leftover=$(digits_in_prose < "$SECTION")
if [ -n "$leftover" ]; then
  echo "closing.tex: a typed numeral sits in the prose: $(echo "$leftover" | tr '\n' ' ')"
  exit 1
fi

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check

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

echo "== render the limitations page of each build"
secpage() { # $1 = pdf path, $2 = unique text fragment
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    # Collapse whitespace: a caption phrase can wrap across lines.
    if grep -qF "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null \
        | tr -s '[:space:]' ' ')"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2
  exit 1
}
PM=$(secpage paper/main.pdf "it computes from")
PD=$(secpage paper/main-dmlr.pdf "it computes from")
pdftoppm -png -r 80 -f "$PM" -l "$PM" paper/main.pdf "$OUT/limitations-main"
pdftoppm -png -r 80 -f "$PD" -l "$PD" paper/main-dmlr.pdf "$OUT/limitations-dmlr"
sha256sum "$OUT"/limitations-main-*.png "$OUT"/limitations-dmlr-*.png
echo "claim table on pages $PM/$PD -> limitations, ok"
