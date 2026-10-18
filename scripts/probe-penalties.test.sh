#!/usr/bin/env bash
# End-to-end check for the probe-penalty split and the term
# definitions (issue #213): the split counts and the figure bar split
# are re-derived from contract-probes.csv, the honest-acceptance
# overclaim is gone, every flagged term is defined at first use or
# replaced, no touched file keeps a bare numeral or a banned word, and
# both PDFs rebuild twice with identical sha256.
# scripts/dmlr.test.sh runs last; it builds from a clean HEAD checkout,
# so run this script on a committed tree.
# See scripts/probe-penalties.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

GEN=paper/generated
S4=paper/sections/adversarial.tex
GS=paper/sections/grader-soundness.tex
VL=paper/sections/verification-layers.tex
FIGP=paper/figures/fig-probe-heatmap.tex
FIGE=paper/figures/fig-exploits.tex
TOUCHED="$S4 $GS $VL $FIGP $FIGE"

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
sha256sum "$GEN"/probe-heatmap* > "$OUT/ph.before"
node scripts/exp/probe-heatmap.mjs > "$OUT/ph.log" 2>&1 \
  || { tail -20 "$OUT/ph.log"; exit 1; }
sha256sum -c "$OUT/ph.before" \
  || { echo "probe-heatmap.mjs moved its outputs; commit them"; exit 1; }
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
git checkout -- paper/data/suite.json
dirty=$(git status --porcelain "$GEN")
if [ -n "$dirty" ]; then
  echo "$dirty"
  echo "collect.mjs moved generated files; commit the regenerated files"; exit 1
fi

echo "== the penalty split matches contract-probes.csv"
macro() { # $1 = macro name, $2 = file -> value of \newcommand{\$1}{..}
  sed -nE "s/.*\\\\$1\\}\\{([^{}]*)\\}.*/\\1/p" "$2" | head -1
}
# Released version per package: the highest version in versions.json.
released=$(node -e '
  const d = JSON.parse(require("fs").readFileSync("scripts/exp/versions.json","utf8"));
  const m = {};
  for (const a of d.artifacts) {
    if (!(a.name in m) || a.version > m[a.name]) m[a.name] = a.version;
  }
  for (const k in m) console.log(k + "," + m[k]);
')
# Type-B probes from the frozen list.
typeb=$(node -e '
  const d = JSON.parse(require("fs").readFileSync("scripts/exp/probes.json","utf8"));
  console.log(d.probes.filter(p => (p.expected||"").startsWith("TYPE B")).map(p => p.id).join(" "));
')
dup=$(printf '%s\n' "$released" | while IFS=, read -r pkg ver; do
    awk -F, -v p="$pkg" -v v="$ver" 'NR>1 && $1==p && $2==v && $3=="atk-dup-tool-calls" && $5=="fail"' paper/data/exp/contract-probes.csv
  done | wc -l)
wrap=$(printf '%s\n' "$released" | while IFS=, read -r pkg ver; do
    awk -F, -v p="$pkg" -v v="$ver" 'NR>1 && $1==p && $2==v && ($3=="atk-prompt-echo" || $3=="atk-score-injection") && $5=="fail"' paper/data/exp/contract-probes.csv
  done | wc -l)
other=$(printf '%s\n' "$released" | while IFS=, read -r pkg ver; do
    for probe in $typeb; do
      awk -F, -v p="$pkg" -v v="$ver" -v pr="$probe" 'NR>1 && $1==p && $2==v && $3==pr && $5=="fail"' paper/data/exp/contract-probes.csv
    done
  done | wc -l)
other=$((other - dup - wrap))
[ "$dup" = "$(macro expProbesDupCallCells "$GEN/exp-macros.tex")" ] \
  || { echo "dup-call fails $dup != \\expProbesDupCallCells"; exit 1; }
[ "$wrap" = "$(macro expProbesWrapCells "$GEN/exp-macros.tex")" ] \
  || { echo "wrap fails $wrap != \\expProbesWrapCells"; exit 1; }
[ "$other" = "0" ] \
  || { echo "$other unnamed type-B fails at released versions"; exit 1; }
moved=$(macro expProbesMovedFailCells "$GEN/exp-macros.tex")
[ "$((dup + wrap))" = "$moved" ] \
  || { echo "type-B split $dup+$wrap != $moved moved fails"; exit 1; }
unpromised=$(printf '%s\n' "$released" | while IFS=, read -r pkg ver; do
    awk -F, -v p="$pkg" -v v="$ver" 'NR>1 && $1==p && $2==v && $4=="honest-variant" && ($5=="pass"||$5=="fail")' paper/data/exp/contract-probes.csv
  done | wc -l)
pkgs=$(printf '%s\n' "$released" | wc -l)
promisedpkgs=$(printf '%s\n' "$released" | while IFS=, read -r pkg ver; do
    awk -F, -v p="$pkg" -v v="$ver" 'NR>1 && $1==p && $2==v && $4=="honest-variant" && ($5=="pass"||$5=="fail") {print $1; exit}' paper/data/exp/contract-probes.csv
  done | wc -l)
[ "$((pkgs - promisedpkgs))" = "$(macro expProbesHonestUnpromised "$GEN/exp-macros.tex")" ] \
  || { echo "unpromised graders $((pkgs - promisedpkgs)) != \\expProbesHonestUnpromised"; exit 1; }
[ "$unpromised" = "$(macro expProbesHonestCells "$GEN/exp-macros.tex")" ] \
  || { echo "promised cells $unpromised != \\expProbesHonestCells"; exit 1; }

echo "== the overclaims are gone and the split is in the text"
if grep -n 'expProbesHonestAccepted' "$GS"; then
  echo "the 22-of-22 acceptance claim survived"; exit 1
fi
for m in expProbesHonestUnpromised expProbesDupCallCells expProbesDupCallPkgs \
    expProbesWrapCells expProbesWrapPkgs expProbesWrapPkgCount expProbesDupCallPkgCount; do
  grep -q "\\$m" "$GS" || { echo "\\$m missing from $GS"; exit 1; }
done
grep -qF 'documented penalty rather than a defect' "$GS" \
  || { echo "$GS does not name the designed penalties"; exit 1; }

echo "== the figure carries the split"
grep -q '^y,fails,designed$' "$GEN/probe-heatmap-fails.csv" \
  || { echo "fails file lost the designed column"; exit 1; }
barf=$(awk -F, 'NR>1 {s+=$2} END{print s+0}' "$GEN/probe-heatmap-fails.csv")
bard=$(awk -F, 'NR>1 {s+=$3} END{print s+0}' "$GEN/probe-heatmap-fails.csv")
wantf=$(awk -F, 'NR>1 && $5=="fail" && $3!="atk-dup-tool-calls"' paper/data/exp/contract-probes.csv | wc -l)
wantd=$(awk -F, 'NR>1 && $5=="fail" && $3=="atk-dup-tool-calls"' paper/data/exp/contract-probes.csv | wc -l)
[ "$barf" = "$wantf" ] || { echo "bar fails $barf != $wantf real fails"; exit 1; }
[ "$bard" = "$wantd" ] || { echo "bar designed $bard != $wantd expected penalties"; exit 1; }
orange=$(awk -F, 'NR>1 && $3==4' "$GEN/probe-heatmap.csv" | wc -l)
[ "$orange" = "$wantd" ] \
  || { echo "heatmap has $orange designed cells, want $wantd"; exit 1; }
for pat in 'expected penalty' 'genuine fails'; do
  grep -qF "$pat" "$FIGP" || { echo "$FIGP lost '$pat'"; exit 1; }
done

echo "== terms are defined at first use"
grep -qF 'shipped in two waves' "$S4" \
  || { echo "wave definition missing in $S4"; exit 1; }
if grep -n 'wave-[12]' paper/sections/intro.tex paper/sections/engine.tex "$VL"; then
  echo "wave-N used before its definition above"; exit 1
fi
wdefoff=$(grep -boF 'shipped in two waves' "$S4" | head -1 | cut -d: -f1)
wuseoff=$(grep -boE 'wave-[12]' "$S4" | head -1 | cut -d: -f1)
{ [ -n "$wdefoff" ] && { [ -z "$wuseoff" ] || [ "$wdefoff" -lt "$wuseoff" ]; }; } \
  || { echo "wave-N used before the wave sentence"; exit 1; }
grep -qF 'the written findings a review round hands the builder' "$S4" \
  || { echo "fix-brief gloss missing in $S4"; exit 1; }
defoff=$(grep -boF 'a clause is a single checkable relation' "$S4" | head -1 | cut -d: -f1)
cntoff=$(grep -boF 'clauses that re-measure' "$S4" | head -1 | cut -d: -f1)
{ [ -n "$defoff" ] && [ -n "$cntoff" ] && [ "$defoff" -lt "$cntoff" ]; } \
  || { echo "the clause counts still precede their definition"; exit 1; }
grep -qF 'r$n$ below cites a row of that list' "$S4" \
  || { echo "r<n> gloss missing in $S4"; exit 1; }
grep -qF 'asks that the new mean sit under the old one' "$S4" \
  || { echo "the loose bound is unexplained in $S4"; exit 1; }
grep -qF 'review council, several reviewer sessions' "$VL" \
  || { echo "council definition missing in $VL"; exit 1; }
if grep -rn 'part-c' paper/sections paper/figures; then
  echo "part-c used above"; exit 1
fi
if grep -n 'type-A\|type-B' paper/sections/intro.tex paper/sections/engine.tex \
    "$VL" "$S4" paper/sections/prereg.tex; then
  echo "type-A/B used before the soundness definitions"; exit 1
fi
grep -qF 'type-B fails on' "$GS" && grep -qF "the probe score to equal the oracle's" "$GS" \
  || { echo "type-B rule not defined in $GS"; exit 1; }
grep -qF 'type-A fails on' "$GS" && grep -qF 'scores above an empty submission' "$GS" \
  || { echo "type-A rule not defined in $GS"; exit 1; }
grep -qF 'the machine-readable catalogue record' "$GEN/suite-table.tex" \
  || { echo "index-entry gloss missing from the suite-table caption"; exit 1; }

echo "== the garbled sentence is gone"
if grep -nF 'pays the exploit on \expExplFixFailsAttackPkgs{}, where' "$S4"; then
  echo "the colliding clause survived"; exit 1
fi
grep -qF "(checkout-consent's stall traces" "$S4" \
  || { echo "$S4 lost the parenthesised exploit detail"; exit 1; }

echo "== no bare numeral in the touched prose"
for f in $TOUCHED; do
  case "$f" in
    *fig-*) src=$(sed -n '/\\caption/p' "$f") ;;
    *adversarial*) src=$(sed -n '7p;10p' "$f") ;; # lines this change edits;
        # the locator literals on line 13 are another PR's fix
    *) src=$(cat "$f") ;;
  esac
  if printf '%s' "$src" | sed -E \
        -e 's/%.*//' \
        -e 's/\\texttt\{[^{}]*\}//g' \
        -e 's/\\emph\{[^{}]*\}//g' \
        -e 's/[a-zA-Z]?\{[0-9.]+\\textwidth\}//g' \
        -e 's/\\[a-zA-Z]+\{[^{}]*\}//g' \
        -e 's/\\[a-zA-Z]+//g' \
        -e 's/wave[- ][0-9]//g' \
        -e 's/0\.[0-9]\.[0-9]//g' \
        -e 's/\b[HL][0-9]\b//g' \
        -e 's/r\$n\$//g' \
        -e 's/atk-[a-z-]+//g' \
        -e 's/hv-[a-z-]+//g' \
        -e 's/CC(-| )?BY(-SA)? ?[0-9.]*//g' \
        -e 's/CC0(-1\.0)?//g' \
        -e 's/[{}\\]//g' | grep -nE '[0-9]'; then
    echo "bare numeral above in $f"; exit 1
  fi
done

echo "== style guard on the touched files"
if grep -nP '[\x{2013}\x{2014}]|---' $TOUCHED; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive|independent)\b' $TOUCHED; then
  echo "banned word found above"; exit 1
fi
if grep -nF ', not ' $TOUCHED; then
  echo "'X, not Y' slogan shape above"; exit 1
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
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    if grep -q "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null)"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2
  exit 1
}
S4M=$(figpage paper/main.pdf "single checkable relation")
S4D=$(figpage paper/main-dmlr.pdf "single checkable relation")
GSM=$(figpage paper/main.pdf "documented penalty")
GSD=$(figpage paper/main-dmlr.pdf "documented penalty")
F7M=$(figpage paper/main.pdf "expected penalty")
F7D=$(figpage paper/main-dmlr.pdf "expected penalty")
VLM=$(figpage paper/main.pdf "several reviewer sessions")
VLD=$(figpage paper/main-dmlr.pdf "several reviewer sessions")
for spec in "main.pdf|$S4M|s4-main" "main-dmlr.pdf|$S4D|s4-dmlr" \
    "main.pdf|$GSM|gs-main" "main-dmlr.pdf|$GSD|gs-dmlr" \
    "main.pdf|$F7M|f7-main" "main-dmlr.pdf|$F7D|f7-dmlr" \
    "main.pdf|$VLM|vl-main" "main-dmlr.pdf|$VLD|vl-dmlr"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "S4 p$S4M/p$S4D, soundness p$GSM/p$GSD, F7 p$F7M/p$F7D, L2 p$VLM/p$VLD -> probe-penalties, ok"
