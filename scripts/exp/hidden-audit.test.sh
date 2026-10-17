#!/usr/bin/env bash
# End-to-end check for E5: the tarball audit and the hidden-split
# overlap run. Installs the four census-qualified artifacts into a
# temp cache, runs both scripts twice into two temp output dirs, and
# diffs the two CSV trees so a nondeterministic generator or scan
# fails loudly. Prints the sha256 of every CSV twice. Read
# hidden-audit.failure-modes.md first.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
CACHE=$(mktemp -d)
trap 'rm -rf "$CACHE"' EXIT
cd "$ROOT"

QUALIFYING="benchmark-pelican@0.1.0 benchmark-pelican@0.2.0 benchmark-cost-per-task@0.2.0 benchmark-accessibility-fix@0.1.0"

echo "== install the four qualifying artifacts into a temp cache"
node scripts/exp/install.mjs --cache "$CACHE" $QUALIFYING

echo "== run tarball-audit.mjs and hidden-overlap.mjs twice"
for run in 1 2; do
  mkdir -p "$CACHE/out$run"
  node scripts/exp/tarball-audit.mjs --cache "$CACHE" --only "$(echo "$QUALIFYING" | tr ' ' ',')" --out "$CACHE/out$run" 2>/dev/null
  node scripts/exp/hidden-overlap.mjs --cache "$CACHE" --only "$(echo "$QUALIFYING" | tr ' ' ',')" --out "$CACHE/out$run" 2>/dev/null
done

echo "== diff the two runs"
for f in tarball-audit.csv hidden-census.csv hidden-overlap.csv; do
  diff "$CACHE/out1/$f" "$CACHE/out2/$f"
done
echo "identical: tarball-audit.csv hidden-census.csv hidden-overlap.csv"

echo "== sha256 of the generated CSVs"
sha256sum "$CACHE"/out1/*.csv
sha256sum "$CACHE"/out2/*.csv
echo "hidden-audit.test.sh: all checks passed"
