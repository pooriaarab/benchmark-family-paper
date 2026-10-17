#!/usr/bin/env bash
# End-to-end check for the E6 determinism run. Installs three pinned
# released-version artifacts into a temp cache (two wave-1, one wave-2),
# runs the full frozen matrix plus the trivial-server arm on them twice,
# prints the sha256 of determinism.csv both times and diffs the two
# files. The three packages are expected deterministic, so a diff fails
# loudly. The full run is:
#
#   node scripts/exp/install.mjs
#   node scripts/exp/determinism.mjs        # about 5 minutes
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT"

ARTIFACTS="benchmark-pelican@0.2.0 benchmark-tool-errors@0.2.0 benchmark-exploit-resistance@0.1.0"

echo "== install 3 released artifacts into a temp cache"
node scripts/exp/install.mjs --cache "$TMP/cache" $ARTIFACTS

ONLY=$(echo "$ARTIFACTS" | tr ' ' ',')

echo "== run the frozen determinism matrix twice"
node scripts/exp/determinism.mjs --cache "$TMP/cache" --out "$TMP/run1" --only "$ONLY"
node scripts/exp/determinism.mjs --cache "$TMP/cache" --out "$TMP/run2" --only "$ONLY"

echo "== sha256 of determinism.csv, run 1"
sha256sum "$TMP/run1/determinism.csv" | sed "s|$TMP/run1/||"
echo "== sha256 of determinism.csv, run 2"
sha256sum "$TMP/run2/determinism.csv" | sed "s|$TMP/run2/||"

diff "$TMP/run1/determinism.csv" "$TMP/run2/determinism.csv"
test "$(wc -l < "$TMP/run1/determinism.csv")" -eq 64
test "$(tail -n +2 "$TMP/run1/determinism.csv" | grep -c ',ok,' )" -eq 63
test "$(tail -n +2 "$TMP/run1/determinism.csv" | grep -c ',yes,' )" -eq 63
echo "determinism.test.sh: identical CSVs across two runs, all checks passed"
