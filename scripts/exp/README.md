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
- `probes.json` — the frozen E4 contract probes (honest variants,
  unpromised-exploratory variants, and type A/B attacks) with
  per-probe `expected` rules; frozen before any run.
- `probes.failure-modes.md` — how the freeze step fails; read first.
- `probes-check.mjs` — validates the freeze, the applicability matrix
  in `paper/data/exp/probe-applicability.csv`, and the oracle table
  in `paper/data/exp/oracle-definition.csv`, then prints their sha256.
- `probes.test.sh` — installs the cited artifacts into a temp cache
  and runs the check twice, diffing the output.
- `contract-probes.mjs` — runs the frozen probes against every pinned
  artifact through each package's SDK and writes
  `paper/data/exp/contract-probes.csv` (one row per artifact x probe).
- `contract-probes.failure-modes.md` — how the run step fails; read
  first.
- `contract-probes.test.sh` — installs three artifacts into a temp
  cache, runs the script twice, and diffs the CSV sha256.
- `determinism.json` — the frozen E6 run matrix: the released version
  of each of the 22 packages, mock seeds 1 and 2, concurrency 1, 4 and
  16, three repeats, plus three trivial-server repeats, the per-run
  timeout and the canonical hash form.
- `determinism.failure-modes.md` — how the determinism run fails;
  read first.
- `determinism.mjs` — runs the frozen matrix, hashes
  (taskId, score, reason) per run and writes
  `paper/data/exp/determinism.csv` with a per-run sha256 and a
  `uniform` flag per (package, path, seed) group.
- `determinism.test.sh` — runs the matrix on three released artifacts
  twice and diffs the two CSVs.
- `hidden-seeds.json` — the frozen E5 seed list: five fresh seeds
  used for hidden-split regeneration. Frozen before the run; the
  paper's public task-split seed 20261015 is never among them.
- `hidden-audit.failure-modes.md` — every way the E5 audit and
  overlap scripts can fail; read it first.
- `tarball-audit.mjs` — E5a. Scans each installed artifact's tree
  for hidden-named files, answer-bearing files outside the public
  split, and concrete seeds in shipped docs, and writes the
  generator census.
- `hidden-overlap.mjs` — E5b. Regenerates the hidden split for each
  census-qualified artifact at the five frozen seeds and measures
  overlap with the public split.
- `hidden-audit.test.sh` — the E5 end-to-end check: installs the
  four qualifying artifacts into a temp cache, runs both scripts
  twice, diffs the CSV trees, prints their sha256.
- `exploits-clauses.mjs` — the shared E2 clause parser and CSV reader,
  used by both `exploits-check.mjs` and the `exploits-run-*` runners so
  a comparison clause means the same thing in the check and the run.
- `exploits-run-a.failure-modes.md` — every way the part-a run fails;
  read first.
- `exploits-run-a.mjs` — runs the 27 part-a exploit rows
  (re-measurable-before-and-after and re-measurable-after-only for
  pelican, skateboard, apology-pizza, ranking-stability,
  accessibility-fix, schema-mutation, latency-budget and
  memory-conflict) against the pinned tarballs through each package's
  SDK and writes `paper/data/exp/exploit-results-a.csv`; one builder
  per frozen row.
- `exploits-run-a.test.sh` — runs the part twice, diffs the two CSVs,
  prints their sha256.
- `exploits-run-b.failure-modes.md` — every way the part-b run fails;
  read first.
- `exploits-run-b.mjs` — runs the part-b exploit rows
  (re-measurable-before-and-after for tool-errors, mcp-safety,
  checkout-consent, honesty, sycophancy, hundred-step) against the
  pinned tarballs through each package's SDK and writes
  `paper/data/exp/exploit-results-b.csv`; one builder per frozen row.
- `exploits-run-b.test.sh` — runs the part twice, diffs the two CSVs,
  prints their sha256.
- `macros.mjs` — turns the E1 CSVs (`trivial-battery-cells`,
  `trivial-headroom`, `trivial-reasons`), `versions.json` and
  `reason-classes.json` into `paper/generated/exp-macros.tex`;
  `--check` fails on a stale generated file or an `\exp*` macro used
  in text but not generated. Later experiment PRs add their CSVs as
  inputs when they add macros.
- `macros.test.sh` — the end-to-end check: proves both guards fire,
  regenerates the file, and rebuilds both PDFs.

## Usage

```bash
node scripts/exp/install.mjs                      # all 34 artifacts
node scripts/exp/install.mjs benchmark-pelican@0.1.0   # one artifact
node scripts/exp/install.mjs --cache /tmp/c ...   # elsewhere
bash scripts/exp/scaffold.test.sh                 # end-to-end check
bash scripts/exp/probes.test.sh                   # probe freeze check
bash scripts/exp/hidden-audit.test.sh             # E5 end-to-end check
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
no experiment PR edits `main.tex` for numbers.

| File | Experiment | Status |
|---|---|---|
| `trivial-battery.csv`, `trivial-battery-cells.csv`, `trivial-reasons.csv`, `trivial-headroom.csv` | E1 trivial battery + E1b reason classes | done |
| exploits.csv | E2 | frozen exploit list: locators, record values, value kinds, measured states, reproducibility classes, comparison rules; no results yet. cost-per-task, test-weakening and payment-delegation carry no row because defects.csv has no in-scope locator for them |
| `contract-probes.csv` | E4 grader contract probes | done |
| `determinism.csv` | E6 determinism and repeat runs | done |
| `tarball-audit.csv`, `hidden-census.csv`, `hidden-overlap.csv` | E5 hidden-split hygiene audit | done |

The vendored server plays eight policies selected by model id
(`trivial-empty`, `trivial-yes`, `trivial-ok`, `trivial-refuse`,
`trivial-echo`, `trivial-firsttool`, `trivial-random`, `trivial-nulljson`).
Point a package at it with `OPENAI_BASE_URL=http://127.0.0.1:PORT/v1`
and any non-empty `OPENAI_API_KEY`. `trivial-random` is seeded by the
request count, so only run it at concurrency 1.
- `exploits-run-c.failure-modes.md` — how the part-c run fails; read
  first.
- `exploits-run-c.mjs` — re-measures the frozen exploit list's
  `needs-source-checkout` rows at their pinned commits (clone, `npm
  ci`, `npm run build`, score through the built package) and writes
  `paper/data/exp/exploit-results-c.csv`.
- `exploits-run-c.test.sh` — runs the runner twice into temp CSVs,
  diffs them, prints sha256. Second run is fully offline.
