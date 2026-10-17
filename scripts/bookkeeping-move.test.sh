#!/usr/bin/env bash
# End-to-end check for the bookkeeping move (C2): regenerate the
# generated tables from the committed CSVs, rebuild both PDFs, fail on
# undefined references or citations or a "??" in the extracted text,
# and print the sha256 of both PDFs and the generated inputs this PR
# adds. See scripts/bookkeeping-move.failure-modes.md for what each
# check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

node scripts/collect.mjs --from-json > "$OUT/collect.log"
cat "$OUT/collect.log"

for target in pdf dmlr; do
  make "$target" > "$OUT/$target.log" 2>&1 \
    || { tail -20 "$OUT/$target.log"; exit 1; }
  if grep -iE "undefined|citation.*undefined|overfull" "$OUT/$target.log"; then
    echo "make $target: undefined references, citations or overfull boxes above"
    exit 1
  fi
done

for f in paper/main.pdf paper/main-dmlr.pdf; do
  if pdftotext "$f" - 2>/dev/null | grep -qF "??"; then
    echo "$f: extracted text contains ?? (a broken reference)"
    exit 1
  fi
done

sha256sum paper/main.pdf paper/main-dmlr.pdf \
  paper/generated/approval-defects.tex paper/generated/review-data.tex
echo "bookkeeping-move.test.sh: all checks passed -> ok"
