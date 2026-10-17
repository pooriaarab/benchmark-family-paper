#!/usr/bin/env bash
# End-to-end check for the experiment scaffold. Installs three pinned
# artifacts into a temp cache, imports each package's `benchmark`
# export through the SDK and prints the task count, runs the mock CLI
# from the cache for five packages, runs one completion against the
# vendored trivial-policy server on a free port, and prints the
# sha256 of versions.json.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
CACHE=$(mktemp -d)
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$CACHE"
}
trap cleanup EXIT
cd "$ROOT"

IMPORTED="benchmark-pelican@0.1.0 benchmark-pelican@0.2.0 benchmark-honesty@0.1.0"
MOCKED="$IMPORTED benchmark-tool-errors@0.1.0 benchmark-mcp-safety@0.1.0"

echo "== install 3 artifacts into a temp cache"
node scripts/exp/install.mjs --cache "$CACHE" $IMPORTED

echo "== import each benchmark export and count tasks"
for id in $IMPORTED; do
  name="${id%@*}"
  (cd "$CACHE/$id" && node -e \
    "import('$name').then(async m => console.log('$id tasks:', (await m.benchmark.listTasks()).length))")
done

echo "== mock CLI run from the cache for 5 packages"
node scripts/exp/install.mjs --cache "$CACHE" $MOCKED
for id in $MOCKED; do
  name="${id%@*}"
  (cd "$CACHE/$id" && npx --no-install "$name" run --provider mock --json) \
    | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('$id mock run ok:', j.totals.tasks, 'tasks, mean', j.mean)"
done

echo "== vendored trivial-policy server on a free port"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
python3 scripts/exp/trivial-policy-server.py --port "$PORT" 2>/dev/null &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/v1/models" >/dev/null && break
  sleep 0.1
done
curl -sf "http://127.0.0.1:$PORT/v1/models" >/dev/null
curl -sf -X POST "http://127.0.0.1:$PORT/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"model":"trivial-yes","messages":[{"role":"user","content":"ping"}]}' \
  | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); const c=j.choices[0].message.content; if(c!=='yes'){console.error('bad completion:',c);process.exit(1)} console.log('completion ok:', c)"

echo "== versions.json sha256"
sha256sum scripts/exp/versions.json
echo "scaffold.test.sh: all checks passed"
