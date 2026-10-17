#!/usr/bin/env bash
# End-to-end check for the E4 contract probe freeze. Installs the
# pinned artifacts cited by probes.json promise_source entries into a
# temp cache, runs probes-check.mjs against it twice, and diffs the
# two outputs so a nondeterministic check fails loudly.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
CACHE=$(mktemp -d)
trap 'rm -rf "$CACHE"' EXIT
cd "$ROOT"

echo "== install artifacts cited by promise_source"
CITED=$(node -e '
  const p = JSON.parse(require("fs").readFileSync("scripts/exp/probes.json", "utf8"));
  const s = new Set();
  for (const pr of p.probes) for (const src of pr.promise_source ?? []) s.add(`${src.package}@${src.version}`);
  console.log([...s].join(" "));
')
echo "cited: $CITED"
node scripts/exp/install.mjs --cache "$CACHE" $CITED

echo "== run probes-check.mjs twice against the temp cache"
node scripts/exp/probes-check.mjs --cache "$CACHE" > "$CACHE/out1.txt"
node scripts/exp/probes-check.mjs --cache "$CACHE" > "$CACHE/out2.txt"
diff "$CACHE/out1.txt" "$CACHE/out2.txt"
cat "$CACHE/out1.txt"
echo "probes.test.sh: identical output across two runs, all checks passed"
