# Determinism run failure modes

Every way `scripts/exp/determinism.mjs` can fail, written before the
code. `scripts/exp/determinism.test.sh` is the end-to-end check.

- A run hangs: a package CLI deadlocks or a task never finishes. Every
  child process gets a hard timeout (`perRunTimeoutMs` in the frozen
  `determinism.json`); a killed run is recorded with `status=timeout`
  and an empty hash, the package is listed as not byte-identical, and
  the run continues. A timeout is a measurement, not a crash.
- The trivial-server port is busy: the script asks the OS for a free
  port (bind to port 0) and polls `/v1/models` for five seconds, the
  same pattern as `scaffold.test.sh` and `trivial-battery.mjs`. A port
  stolen in the gap shows up as a failed health check, not a wrong run.
- The cache is missing an artifact: the run needs `install.ok` in every
  artifact directory the frozen matrix names. Missing markers are
  listed up front with a pointer to `install.mjs`; the script never
  installs an unpinned tree itself.
- Clock-based scoring: `benchmark-latency-budget` measures real
  `performance.now()` gaps between turns into
  `finalState.turnTimesMs` and the grader bills them as model time,
  so totals and even pass/fail near a deadline can move between runs.
  The script does not set `LATENCY_BUDGET_CLOCK` or any other knob;
  drift like this is the measurement. A drifting package is reported
  by name with the cause read from its source, never hidden.
- A run fails transiently: mirroring `trivial-battery.mjs`, a failed
  cell is retried once. A retry that succeeds is recorded with
  `status=ok-after-retry`; a second failure records `status=failed`
  (or `timeout`) with an empty hash and the run continues.
- Concurrency scrambles row order: graders may emit rows in
  completion order, which differs at concurrency 16. Rows are
  serialised as `JSON.stringify([taskId, score, reason])` and sorted
  before hashing, so order alone can never masquerade as drift; only a
  real change in a task id, score or reason moves the sha256.
- Reason strings carry tabs or newlines: the canonical form is
  JSON-escaped per row, so the hash input is unambiguous.
- A nondeterministic package is confused with an infrastructure
  failure: `status=ok` rows whose hashes differ inside a
  (package, path, seed) group are drift; `failed`/`timeout` rows are
  run failures. The CSV keeps both distinct and the summary lists
  each separately.
- A killed run leaves partial data: all rows are held in memory and
  `determinism.csv` is written once at the end, so an interrupted run
  leaves no half-written file. Rerunning overwrites wholesale.
- The trivial server keeps state between runs: `trivial-random` is
  seeded by the server's request count, so the frozen matrix uses the
  stateless `trivial-echo` policy only. Any server state that still
  leaks into a result shows up as a hash difference across the three
  repeats, which is reported.
- Numbers drift inside the CSV: the file stores only deterministic
  content (package, version, matrix coordinates, row count, mean,
  sha256, status, node version). No durations or timestamps are
  recorded, so when every measured package is deterministic the CSV
  itself is byte-identical across runs and the test script's two
  sha256 prints match.
- Node version drift: results can legitimately differ across Node
  releases. `node -v` is captured once and written into every row;
  comparing runs across Node versions is out of scope for this
  experiment.
