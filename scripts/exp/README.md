# Experiment scaffold

Offline, free, deterministic measurement of the shipped benchmark
artifacts, for the v2 experiments (E1-E6). Nothing here calls a paid
API. `scripts/exp/failure-modes.md` lists every way this scaffold can
fail; read it before changing anything.

## What is here

- `versions.json` — the frozen pin list: all 22 packages at 0.1.0 plus
  the 12 wave-1 packages at 0.2.0 (34 artifacts), each with its npm
  tarball URL and sha512 `dist.integrity` as reported on 2026-10-17.
- `install.mjs` — installs artifacts into `.exp-cache/` (gitignored).
  Verifies each tarball's sha512 before install, fails loudly on a
  mismatch, and is idempotent via an `install.ok` marker.
- `trivial-policy-server.py` — OpenAI-compatible endpoint that plays a
  fixed trivial policy, vendored from `pooriaarab/scripts` (source
  commit in its header) so this repo reproduces alone.
- `scaffold.test.sh` — the end-to-end check for all of the above.

## Usage

```bash
node scripts/exp/install.mjs                      # all 34 artifacts
node scripts/exp/install.mjs benchmark-pelican@0.1.0   # one artifact
node scripts/exp/install.mjs --cache /tmp/c ...   # elsewhere
bash scripts/exp/scaffold.test.sh                 # end-to-end check
```

Each artifact lands in `.exp-cache/<name>@<version>/` as a self-
contained npm prefix: `node_modules/<name>` for SDK imports and
`node_modules/.bin/benchmark-<name>` for the CLI. Inside that directory:

```bash
node -e 'import("benchmark-pelican").then(async m => console.log((await m.benchmark.listTasks()).length))'
npx --no-install benchmark-pelican run --provider mock --json
```

`listTasks()` is async. `--no-install` keeps npx on the pinned local
copy; without it npx may fetch an unpinned version when the local
lookup misses. Known limit: each artifact's own dependencies
(`benchmark-core`, the MCP SDK) resolve at install time and are not
pinned; only the measured tarball is. A fresh cache can therefore pick
up a newer dependency than an old one held.

## Experiment output contract

Every experiment script writes one CSV to `paper/data/exp/<name>.csv`
and adds a row to the table below. Per-row data, no aggregates only;
the paper's numbers come from these files through generated macros.
`scripts/exp/macros.mjs` turns the CSVs into `paper/generated/exp-macros.tex`;
it is built in PR B1, so no experiment PR edits `main.tex` for numbers.

| File | Experiment | Status |
|---|---|---|
| `trivial-battery.csv`, `trivial-battery-cells.csv`, `trivial-reasons.csv`, `trivial-headroom.csv` | E1 trivial battery + E1b reason classes | done |

The vendored server plays eight policies selected by model id
(`trivial-empty`, `trivial-yes`, `trivial-ok`, `trivial-refuse`,
`trivial-echo`, `trivial-firsttool`, `trivial-random`, `trivial-nulljson`).
Point a package at it with `OPENAI_BASE_URL=http://127.0.0.1:PORT/v1`
and any non-empty `OPENAI_API_KEY`. `trivial-random` is seeded by the
request count, so only run it at concurrency 1.
