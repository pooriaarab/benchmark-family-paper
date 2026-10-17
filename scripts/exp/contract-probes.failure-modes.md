# Contract probe run failure modes

Every way this run step can fail, written before `contract-probes.mjs`
and `contract-probes.test.sh`. The probe list, the applicability matrix,
and the oracle table are frozen; this note covers only the run. A probe
that cannot run as written is recorded `not-runnable` with the reason;
the frozen files are never edited.

## Oracle derivation

- Wrong row picked for the oracle: the good mock row is chosen by the
  same `((fnv1a(taskId) ^ seed) & 1) === 1` bit the engine uses, over
  mock runs at seeds 1 and 2. A task with no good row at either seed is
  skipped, and every skip shrinks the probe's in-scope count.
- The run-row submission is not re-gradable: the script re-scores it
  through `benchmark.score` under the same seed and warns per artifact
  when it disagrees with the stored row score. A good mock that scores
  below 1 is still the oracle; comparisons use that measured score.

## Transform construction

- A transform that needs a field the oracle lacks (no `answer` for an
  answer-editing probe, no `toolLog` for a trace probe): that task is
  outside scope; when no in-scope task remains the cell is
  `not-runnable`.
- A candidate set read from the wrong place: each `applies-to-tasks`
  selector is resolved in code (`family=` reads `metadata.family`,
  `goal=` reads `input.goal.type`, `answer=numeric` and
  `answer=non-null` read the oracle answer, `carrier=trace` reads the
  oracle toolLog for a money surface). A selector with no matching
  tasks makes the cell `not-runnable`.
- A shotgun trace built with invented tools: every decisive call name
  comes from the oracle trace or from the names the episode's own mock
  runs recorded; none are invented, and an empty candidate set makes
  the cell `not-runnable`. Checkout has no callable decline outcome:
  only `pay` is a call, so the shotgun carries the pay call alone.
- `atk-forged-tool-results` enumerates the tool surface as the union of
  names across all mock-run rows of the artifact, and fabricates each
  result as the empty value of the JSON type that tool returned there.
- `atk-forged-finalstate` submits the oracle's `finalState` verbatim
  when one exists (the real success state claimed without work), else
  `{ "completed": true }`.

## Grading and output

- A probe that crashes the grader: `score` calls are wrapped per task;
  a throw counts as `error` on the row and fails a `yes` cell.
- Nondeterminism: comparisons use a 0.001 tolerance, and
  `contract-probes.test.sh` runs the script twice and diffs the sha256
  of the CSV; a flaky grader shows up as a hash mismatch.
- A wrong cell labelled pass or fail: `pass`/`fail` appear only on
  `yes` cells; exploratory verdicts print `exploratory`, `no` verdicts
  print `outside-contract`, and the `outside_contract` flag marks only
  the `no` cells. One row per artifact-probe pair (34 x 17 = 578).
- Frozen-list drift: the script prints the sha256 of `probes.json` and
  `probe-applicability.csv` so the run PR records which freeze ran.
- A missing cache: every pinned artifact must show `install.ok` under
  `--cache` (default `.exp-cache/`); a missing one aborts by name.
