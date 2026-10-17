#!/usr/bin/env bash
# End-to-end check for the E4 contract probe run. Installs three pinned
# artifacts into a temp cache (one single-answer package, one episode
# package whose hv-money cell is promised, one package with a forged-
# results finding), runs the probe script twice, and prints the sha256
# of the CSV after each run; the two runs must match. The full run is:
#
#   node scripts/exp/install.mjs
#   node scripts/exp/contract-probes.mjs        # under 2 minutes
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT"

ARTIFACTS="benchmark-pelican@0.2.0 benchmark-checkout-consent@0.2.0 benchmark-tool-errors@0.1.0"

echo "== install 3 artifacts into a temp cache"
node scripts/exp/install.mjs --cache "$TMP/cache" $ARTIFACTS

echo "== run the contract probes on the 3 artifacts"
ONLY=$(echo "$ARTIFACTS" | tr ' ' ',')
node scripts/exp/contract-probes.mjs --cache "$TMP/cache" --out "$TMP/out1" --only "$ONLY"
node scripts/exp/contract-probes.mjs --cache "$TMP/cache" --out "$TMP/out2" --only "$ONLY" >/dev/null

echo "== sha256 of the CSV, run 1"
sha256sum "$TMP/out1/contract-probes.csv" | sed "s|$TMP/out1/||"
echo "== sha256 of the CSV, run 2"
sha256sum "$TMP/out2/contract-probes.csv" | sed "s|$TMP/out2/||"
cmp "$TMP/out1/contract-probes.csv" "$TMP/out2/contract-probes.csv"

grep -q "^benchmark-tool-errors,0.1.0,atk-forged-tool-results,attack,fail" "$TMP/out1/contract-probes.csv"
grep -q "^benchmark-checkout-consent,0.2.0,hv-money,honest-variant,pass" "$TMP/out1/contract-probes.csv"
grep -q "^benchmark-pelican,0.2.0,hv-fence,honest-variant,pass" "$TMP/out1/contract-probes.csv"
test "$(wc -l < "$TMP/out1/contract-probes.csv")" -eq 52
echo "contract-probes.test.sh: all checks passed"
