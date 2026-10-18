# Policy-tier ladder (F4) failure modes

Every way the F4 pipeline can fail, written before the code.
`scripts/exp/policy-ladder.mjs` reads `scripts/exp/versions.json`,
`paper/data/exp/trivial-headroom.csv`, the frozen list
`paper/data/exp/exploits.csv` and the two released-version result
files (`exploit-results-a.csv`, `-b.csv`), and writes the figure
inputs into `paper/generated/` (`policy-ladder-{blind,taskaware,
oracle,labels}.csv`, `policy-ladder-stems.tex`,
`policy-ladder-macros.tex`). `policy-ladder.test.sh` is the
end-to-end check; each row below names the guard that catches it.

- The released version picked wrong: it is the highest version
  `versions.json` pins per package (0.2.0 for wave 1, 0.1.0 for
  wave 2), the same rule `macros.mjs` uses. A headroom row at a
  version that is not pinned, a missing released-version row, or a
  duplicated artifact row fails by name.
- A blind or oracle value out of range: `best_trivial` and `oracle`
  must parse and sit in [0,1]; a malformed headroom CSV fails the
  header check field for field.
- A no-data package plotted as zero: packages with no E2 attack row
  at the released version get a `no E2 row` node at the row's
  middle, never a point. The e2e check counts the nodes and the
  emitted task-aware points and requires they sum to the row count.
- An honest re-check plotted as a policy: the task-aware tier is the
  E2 builders, so only rows whose frozen row `isAttackRow` accepts
  count. A `record_value` form `parseRecordValue` does not know
  throws instead of misclassifying the row.
- A result row that cannot join the frozen list: the `row` column is
  the exploits.csv line number; a dangling line or a
  package/locator mismatch fails the join by name, as does a
  measurement at a version versions.json does not pin or a wave-2
  row at 0.2.0.
- Part-c rows on the released-version axis: part c measures pinned
  commits, so the script never opens `exploit-results-c.csv`. The
  file selection itself is the guard.
- The prompt-reading tier sneaking in: E3 was not run, so the figure
  draws exactly three series and the caption says the middle rung is
  skipped; the check greps the figure for a fourth `addplot`.
- A nonexistent prompt-reading or oracle claim: the oracle column is
  the mock good mean from `trivial-headroom.csv`, and
  `oracle-definition.csv` is cited in the caption only as the
  definition source; the ladder claims nothing about real models.
- Figure that does not fit or is unreadable in grayscale: 22 rows
  pin `height=0.8\textheight`; the three tiers differ by mark shape
  (filled circle, filled diamond, filled square) as well as colour;
  wave 2 sits below a dashed rule labelled exploratory. The check
  greps both build logs for `overfull` and renders the figure page
  from each PDF for review.
- Stale generated output: the check regenerates twice and requires
  identical sha256 across the runs, then runs the generator's
  `--check` so a hand-edited CSV or stem file cannot pass.
