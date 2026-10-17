#!/usr/bin/env bash
# End-to-end check for the trivial battery. Installs three pinned
# artifacts into a temp cache (one single-kind wave-1 package, one
# episode package, one wave-2 package), runs all 8 trivial policies on
# them plus the mock oracle pair, and prints the sha256 of every CSV
# the battery writes. The full run is:
#
#   node scripts/exp/install.mjs
#   node scripts/exp/trivial-battery.mjs        # about 5 minutes
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT"

ARTIFACTS="benchmark-pelican@0.1.0 benchmark-tool-errors@0.1.0 benchmark-exploit-resistance@0.1.0"

echo "== install 3 artifacts into a temp cache"
node scripts/exp/install.mjs --cache "$TMP/cache" $ARTIFACTS

echo "== run the battery on the 3 artifacts"
ONLY=$(echo "$ARTIFACTS" | tr ' ' ',')
node scripts/exp/trivial-battery.mjs --cache "$TMP/cache" --out "$TMP/out" --only "$ONLY"

echo "== CSV outputs"
for f in trivial-battery.csv trivial-battery-cells.csv trivial-reasons.csv trivial-headroom.csv; do
  test -s "$TMP/out/$f"
  echo "$f: $(wc -l < "$TMP/out/$f") lines"
done

echo "== sha256 of the CSV outputs"
sha256sum "$TMP"/out/*.csv | sed "s|$TMP/out/||"

grep -q "^benchmark-tool-errors,0.1.0,trivial-echo,0.2125" "$TMP/out/trivial-battery-cells.csv"
grep -q "^benchmark-pelican,0.1.0,1.0000," "$TMP/out/trivial-headroom.csv"
echo "trivial-battery.test.sh: all checks passed"
