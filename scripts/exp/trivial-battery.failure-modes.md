# Trivial battery failure modes

Every way `scripts/exp/trivial-battery.mjs` can fail, written before the
code. `scripts/exp/trivial-battery.test.sh` is the end-to-end check.

- Server port busy: the script asks the OS for a free port (bind to
  port 0) instead of taking a fixed one, the same pattern as
  `scaffold.test.sh`. A port stolen in the gap shows up as a failed
  health check, not a wrong run.
- Server never comes up: Python missing, a syntax error in the vendored
  file, or the port collision above. The script polls `/v1/models` for
  five seconds and exits nonzero naming the cause instead of running
  cells against a dead endpoint.
- The cache is missing an artifact: the run needs `install.ok` in every
  artifact directory it touches. A missing marker means the pinned
  tarball was never installed or was half-cleaned; the script lists the
  missing artifacts and tells the reader to run `install.mjs`, rather
  than silently reinstalling an unpinned tree.
- A package crashes: the CLI exits nonzero or stdout is not a JSON
  report. Mirroring `eval-matrix`, the cell is retried once; a second
  failure records the cell as failed (empty mean, zero rows) and the
  run continues. A retried cell doubles its request count against the
  server, which is exactly what the registered runner did.
- A grader reason is empty or missing: the row still lands in
  `trivial-battery.csv` with an empty reason field. At classification
  time an empty reason matches no regex and counts as `unclassified`;
  it is reported, never dropped.
- A reason matches no class: same path. If more than 10 percent of
  zero-score rows across the run end up `unclassified` the script
  prints a warning naming the rate. The warning is loud but not fatal;
  the frozen classes live in `reason-classes.json` and updating them is
  a separate freeze commit, not a rerun hack.
- `trivial-random` drifts: the policy is seeded by the server's request
  count, so the whole battery shares one server and cells run in the
  registered `eval-matrix` order (policy major, then package, then
  version, sequential, concurrency 1). Splitting the run over several
  servers or reordering cells changes `trivial-random` rows and can
  break the replication check; the README says so.
- A cell runs twice against one server: rerunning a policy block on the
  same server advances the request counter and changes later
  `trivial-random` draws. The script runs each cell once per process
  and never reuses a server across invocations.
- Replication mismatch: the 192 registered cells' best values are
  compared to `paper/data/trivial.csv` within 0.001. Every mismatch is
  printed and the script exits nonzero. A non-replication is a finding
  about the record or about a drifted artifact, not a bug to patch
  around by widening the tolerance.
- Partial output on a killed run: all rows are held in memory and the
  CSVs are written only after the last cell finishes, so a killed run
  leaves no half-written data files. Rerunning overwrites the outputs
  wholesale.
- Numbers drift inside the CSVs: scores and means are written at fixed
  precision and no timestamps or durations are recorded, so two runs of
  the same code and pins produce byte-identical CSVs and the test
  script's sha256 is stable.
