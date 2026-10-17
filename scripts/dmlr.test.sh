#!/usr/bin/env bash
# End-to-end check for the DMLR submission build. Builds both PDFs from a
# clean checkout of HEAD (uncommitted work is not covered), diffs the
# abstract against main.tex, checks that every package in suite.txt has a
# supplement row, and prints the sha256 of the two .tex sources.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$TMP"

make -C "$TMP" dmlr dmlr-supplement

test -s "$TMP/paper/main-dmlr.pdf" || { echo "missing main-dmlr.pdf"; exit 1; }
test -s "$TMP/paper/supplement-dmlr.pdf" || { echo "missing supplement-dmlr.pdf"; exit 1; }

# Abstract must be identical between the NeurIPS and DMLR mains.
sed -n '/\\begin{abstract}/,/\\end{abstract}/p' "$TMP/paper/main.tex" > "$TMP/abs-main.txt"
sed -n '/\\begin{abstract}/,/\\end{abstract}/p' "$TMP/paper/main-dmlr.tex" > "$TMP/abs-dmlr.txt"
diff -u "$TMP/abs-main.txt" "$TMP/abs-dmlr.txt"

# Every package in the suite has a documentation row and an access row.
# Doc-table rows use the same stripped-name convention as suite-table.tex,
# so the generator tags each row with a "% <full id>" marker comment.
ROWS=$(grep -c '^% benchmark-' "$TMP/paper/generated/dmlr-suite-rows.tex")
[ "$ROWS" = "22" ] || { echo "suite rows: $ROWS, want 22"; exit 1; }
while IFS= read -r pkg; do
  grep -qF "$pkg" "$TMP/paper/generated/dmlr-access-rows.tex" \
    || { echo "missing access row: $pkg"; exit 1; }
  grep -qF "$pkg" "$TMP/paper/generated/dmlr-suite-rows.tex" \
    || { echo "missing suite row: $pkg"; exit 1; }
done < "$TMP/paper/data/suite.txt"

# escaping: one pass, no lost braces, no live backslash
esc=$(node -e '
const src = require("fs").readFileSync(process.argv[1], "utf8");
eval(src.match(/function tex\(s\) \{[\s\S]*?\n\}\n/)[0] + "; console.log(tex(\"a_b {x} c\\\\d ~ ^\"))")' "$ROOT/scripts/gen-dmlr-supplement.mjs")
[ "$esc" = 'a\_b \{x\} c\textbackslash{}d \textasciitilde{} \textasciicircum{}' ] \
  || { echo "tex() escaping wrong: $esc"; exit 1; }
# the source target refuses to package an OWNER TO CONFIRM line
grep -q "OWNER TO CONFIRM" "$ROOT/Makefile" || { echo "Makefile lacks the placeholder guard"; exit 1; }

sha256sum "$TMP/paper/main-dmlr.tex" "$TMP/paper/supplement-dmlr.tex"
for p in main-dmlr supplement-dmlr; do
  pages=$(pdfinfo "$TMP/paper/$p.pdf" | awk '/^Pages/ {print $2}')
  echo "$p.pdf: $pages pages"
done
echo "dmlr.test.sh: all checks passed"
