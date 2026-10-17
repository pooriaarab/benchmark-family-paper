#!/usr/bin/env bash
# End-to-end check for the related-work compression (C9): rebuild both
# PDFs, fail on undefined references or citations or a "??" in the
# extracted text, report the section's page span, and print the sha256
# of both PDFs. See scripts/related-compress.failure-modes.md for what
# each check catches.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

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

pages=$(pdfinfo paper/main.pdf | awk '/^Pages/ {print $2}')
start=""
for i in $(seq 1 "$pages"); do
  if pdftotext -f "$i" -l "$i" paper/main.pdf - 2>/dev/null | grep -q "Related work"; then
    start=$i; break
  fi
done
[ -n "$start" ] || { echo "Related work heading not found"; exit 1; }
end="$start"
for i in $(seq "$start" "$pages"); do
  if pdftotext -f "$i" -l "$i" paper/main.pdf - 2>/dev/null | grep -q "Limitations and what this does not show"; then
    end=$i; break
  fi
  end=$i
done
echo "Related work spans pages $start to $end of $pages"

sha256sum paper/main.pdf paper/main-dmlr.pdf
echo "related-compress.test.sh: all checks passed -> ok"
