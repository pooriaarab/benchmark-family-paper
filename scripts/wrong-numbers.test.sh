#!/usr/bin/env bash
# End-to-end check for the wrong-number fixes (issue #212): every
# corrected claim is a generated macro that the e2e re-derives from the
# CSVs, the unpaired attack median is no longer cited, the severity
# count always names its denominator, the seed recount in macros.mjs
# and the figure column agree, the claim table drops "all 22", no
# touched file keeps a hard-typed numeral or a banned word, and both
# PDFs rebuild twice with identical sha256.
# scripts/dmlr.test.sh runs last; it builds from a clean HEAD checkout,
# so run this script on a committed tree.
# See scripts/wrong-numbers.failure-modes.md for what each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

GEN=paper/generated
MAIN=paper/main.tex
DMLR=paper/main-dmlr.tex
S4=paper/sections/adversarial.tex
CLO=paper/sections/closing.tex
GS=paper/sections/grader-soundness.tex
INT=paper/sections/intro.tex
VL=paper/sections/verification-layers.tex
FIG=paper/figures/fig-hidden-audit.tex
TOUCHED="$S4 $CLO $GS $INT $VL $FIG"

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
sha256sum "$GEN"/hidden-audit-*.csv "$GEN/hidden-audit-macros.tex" \
  > "$OUT/ha.before"
node scripts/exp/hidden-audit-plot.mjs > "$OUT/ha.log" 2>&1 \
  || { tail -20 "$OUT/ha.log"; exit 1; }
sha256sum -c "$OUT/ha.before" \
  || { echo "hidden-audit-plot.mjs moved its outputs; commit them"; exit 1; }
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
git checkout -- paper/data/suite.json
dirty=$(git status --porcelain "$GEN")
if [ -n "$dirty" ]; then
  echo "$dirty"
  echo "collect.mjs moved generated files; commit the regenerated files"; exit 1
fi

echo "== the corrected claims are generated macros that match the data"
macro() { # $1 = macro name, $2 = file -> value of \newcommand{\$1}{..}
  sed -nE "s/.*\\\\$1\\}\\{([^{}]*)\\}.*/\\1/p" "$2" | head -1
}
# Record clauses split by artifact kind: a and b rows are released
# tarballs; c rows split on the "intermediate commit" measured_state.
released=$(awk -F, 'NR>1 && ($10=="replicated"||$10=="not-replicated")' \
    paper/data/exp/exploit-results-a.csv paper/data/exp/exploit-results-b.csv \
    | wc -l)
released=$((released + $(awk -F, 'NR>1 && ($9=="replicated"||$9=="not-replicated") && $3 !~ /intermediate commit/' \
    paper/data/exp/exploit-results-c.csv | wc -l)))
commit=$(awk -F, 'NR>1 && ($9=="replicated"||$9=="not-replicated") && $3 ~ /intermediate commit/' \
    paper/data/exp/exploit-results-c.csv | wc -l)
[ "$released" = "$(macro expExplRecordReleased "$GEN/exp-macros.tex")" ] \
  || { echo "record released split $released != \\expExplRecordReleased"; exit 1; }
[ "$commit" = "$(macro expExplRecordCommit "$GEN/exp-macros.tex")" ] \
  || { echo "record commit split $commit != \\expExplRecordCommit"; exit 1; }
total=$(macro expExplRecordClauses "$GEN/exp-macros.tex")
[ "$((released + commit))" = "$total" ] \
  || { echo "artifact split $released+$commit != $total record clauses"; exit 1; }
# The seed recount: documented values that are neither the public seed
# nor a bare year; it must match the macro and the figure column sum.
pub=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("scripts/exp/hidden-seeds.json","utf8")).publicSeed)')
kept=$(awk -F, -v pub="$pub" 'NR>1 && $10!="none" {
    n=split($10,a,";");
    for(i=1;i<=n;i++) if (a[i]!=pub && a[i] !~ /^(19|20)[0-9][0-9]$/) print a[i]
  }' paper/data/exp/tarball-audit.csv)
other=$(printf '%s\n' "$kept" | grep -c .)
[ "$other" = "$(macro expAuditSeedExamplesOther "$GEN/exp-macros.tex")" ] \
  || { echo "seed recount $other != \\expAuditSeedExamplesOther"; exit 1; }
figsum=$(awk -F, 'NR>1 && $1==2 {s+=$3} END{print s+0}' "$GEN/hidden-audit-leaks.csv")
[ "$figsum" = "$other" ] \
  || { echo "figure other-seed-values column sums to $figsum, recount gives $other"; exit 1; }
printf 'kept seed values: %s\n' "$(printf '%s' "$kept" | sort | uniq | tr '\n' ' ')"
# The classed-package count is the package union of defects.csv.
classed=$(awk -F, 'NR>1 {n=split($2,a,";"); for(i=1;i<=n;i++) print a[i]}' \
    paper/data/defects.csv | sort -u | wc -l)
[ "$classed" = "$(macro defectClassedPackages "$GEN/defects-macros.tex")" ] \
  || { echo "classed packages $classed != \\defectClassedPackages"; exit 1; }
# The approval locators come from approval-defects.csv.
[ "$(awk -F, 'NR>1 && $1=="benchmark-pelican" {print $2}' paper/data/approval-defects.csv)" \
    = "$(macro approvalPelicanPr "$GEN/review-data.tex")" ] \
  || { echo "\\approvalPelicanPr drifts from approval-defects.csv"; exit 1; }
[ "$(awk -F, 'NR>1 && $1=="benchmark-sycophancy" {print $2}' paper/data/approval-defects.csv)" \
    = "$(macro approvalSycophancyPr "$GEN/review-data.tex")" ] \
  || { echo "\\approvalSycophancyPr drifts from approval-defects.csv"; exit 1; }
grep -oE '\(issue [0-9]+\)' paper/data/approval-defects.csv | grep -oE '[0-9]+' \
  | grep -qx "$(macro approvalPelicanIssue "$GEN/review-data.tex")" \
  || { echo "\\approvalPelicanIssue drifts from approval-defects.csv"; exit 1; }

echo "== the unpaired attack median is no longer cited"
if grep -rnP '\\expExplAtkMedian(Old|New)\b' paper/ --include='*.tex' \
    | grep -v 'generated/'; then
  echo "unpaired median macro cited above"; exit 1
fi
for m in expExplRecordReleased expExplRecordCommit expExplAtkPairs \
    expExplAtkMedianOldPaired expExplAtkMedianNewPaired; do
  for f in "$MAIN" "$DMLR" "$INT"; do
    grep -q "\\$m" "$f" || { echo "\\$m missing from $f"; exit 1; }
  done
done
if grep -nF 'on the published tarballs replicates' "$MAIN" "$DMLR" "$INT"; then
  echo "flat tarballs-only replication wording survived above"; exit 1
fi

echo "== the severity count names its denominator everywhere"
grep -qF '\councilSeverityFeaturePrs{} of them' "$S4" \
  || { echo "$S4 lost the merged-feature severity count"; exit 1; }
while IFS= read -r line; do
  file=${line%%:*}
  [ "$file" = "paper/sections/app-review-stats.tex" ] && continue
  grep -q 'councilPrsReviewed' <<< "$line" \
    || { echo "denominator-free severity count: $line"; exit 1; }
done < <(grep -rn 'councilSeverityPrsRead' paper/sections "$MAIN" "$DMLR")

echo "== the claim table drops the 22-package claim"
if grep -nF 'across all' "$CLO"; then
  echo "'across all' survived in $CLO"; exit 1
fi
grep -qF '\defectClassedPackages{} of \suitePackages{}' "$CLO" \
  || { echo "$CLO does not state the classed-package share"; exit 1; }

echo "== no bare numeral in the touched prose"
# Strip \texttt and \emph literals, brace arguments, macro calls,
# column specs, comments, package versions, wave labels, hypothesis and
# layer names and licence names, then no digit may remain.
for f in $TOUCHED; do
  case "$f" in
    *fig-*) src=$(sed -n '/\\caption/p' "$f") ;;
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
        -e 's/\br[0-9][0-9]*\b//g' \
        -e 's/CC(-| )?BY(-SA)? ?[0-9.]*//g' \
        -e 's/CC0(-1\.0)?//g' \
        -e 's/[{}\\]//g' | grep -nE '[0-9]'; then
    echo "bare numeral above in $f"; exit 1
  fi
done
for f in "$MAIN" "$DMLR"; do
  if { sed -n '/\\begin{abstract}/,/\\end{abstract}/p' "$f"; \
       sed -n '/\\title{/p;/\\section{Setting/p' "$f"; } | sed -E \
        -e 's/\\texttt\{[^{}]*\}//g' \
        -e 's/\\[a-zA-Z]+\{[^{}]*\}//g' \
        -e 's/\\[a-zA-Z]+//g' \
        -e 's/0\.[0-9]\.[0-9]//g' \
        -e 's/\b[HL][0-9]\b//g' \
        -e 's/wave[- ][0-9]//g' \
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
  # Command substitution, not a pipe: grep -q exiting early would
  # SIGPIPE pdftotext and pipefail would read a match as a miss.
  local pages; pages=$(pdfinfo "$1" | awk '/^Pages/ {print $2}')
  for i in $(seq 1 "$pages"); do
    # Collapse whitespace: a phrase can wrap across pdftotext lines.
    if grep -q "$2" <<< "$(pdftotext -f "$i" -l "$i" "$1" - 2>/dev/null \
        | tr -s '[:space:]' ' ')"; then
      echo "$i"; return
    fi
  done
  echo "fragment '$2' not found in $1" >&2
  exit 1
}
ABM=$(figpage paper/main.pdf "paired wave-1 rows")
ABD=$(figpage paper/main-dmlr.pdf "paired wave-1 rows")
S4M=$(figpage paper/main.pdf "approvals standing behind defects")
S4D=$(figpage paper/main-dmlr.pdf "approvals standing behind defects")
GSM=$(figpage paper/main.pdf "seed-like values")
GSD=$(figpage paper/main-dmlr.pdf "seed-like values")
CLM=$(figpage paper/main.pdf "Probing found defects")
CLD=$(figpage paper/main-dmlr.pdf "defects the gates")
for spec in "main.pdf|$ABM|abs-main" "main-dmlr.pdf|$ABD|abs-dmlr" \
    "main.pdf|$S4M|s4-main" "main-dmlr.pdf|$S4D|s4-dmlr" \
    "main.pdf|$GSM|fig8-main" "main-dmlr.pdf|$GSD|fig8-dmlr" \
    "main.pdf|$CLM|claim-main" "main-dmlr.pdf|$CLD|claim-dmlr"; do
  IFS='|' read -r pdf page name <<< "$spec"
  pdftoppm -png -r 80 -f "$page" -l "$page" "paper/$pdf" "$OUT/$name"
done
sha256sum "$OUT"/*.png

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "abstract p$ABM/p$ABD, S4 p$S4M/p$S4D, Fig 8 p$GSM/p$GSD, claim table p$CLM/p$CLD -> wrong-numbers, ok"
