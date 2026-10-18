# Experiment macros failure modes

Every way the macro pipeline can fail, written before the code.
`scripts/exp/macros.mjs` generates `paper/generated/exp-macros.tex`
from the committed experiment CSVs, `scripts/exp/versions.json` and
`scripts/exp/probes.json`;
`node scripts/exp/macros.mjs --check` is the guard and
`scripts/exp/macros.test.sh` is the end-to-end check. Each row says
which guard catches it.

- An input file missing or truncated: `readCsv` fails naming the path,
  or a missing header column fails the per-file schema check. No
  macros are emitted from partial data.
- CSV shape drift: a row whose field count differs from the header,
  an empty `mean`/`best_trivial`/`headroom` that is not one of the
  documented empty cases (a failed cell, an unmeasured version), or a
  non-numeric value in a numeric column fails validation naming the
  file and row.
- A package or version the pin list does not know: every package,
  version and policy named in the CSVs is checked against
  `versions.json`. A CSV row naming something unpinned fails instead
  of silently widening the suite.
- Duplicate cells: two rows for the same
  (package, version, policy) in `trivial-battery-cells.csv` fail, so
  the best-trivial computation never picks between two recorded
  values for one cell.
- A cell that failed in the battery: its `mean` is empty. It counts
  in `\expFailedCells` and is excluded from best/headroom math rather
  than read as zero, which would fabricate a defect or hide one.
- Headroom row without a best or an oracle: emitted as missing in the
  battery output; the macro pass fails instead of printing `NaN` into
  the paper.
- A version arm with no measured best score at all: each group max
  (wave 1 at 0.1.0, wave 1 at 0.2.0, wave 2 released) drops the
  unmeasured rows and fails when none remain, so an all-missing arm
  cannot print 0 as if it were a measured score.
- "Released version" drift: the released version per package is the
  highest version pinned in `versions.json` (0.2.0 for wave 1, 0.1.0
  for wave 2). Hardcoding 0.2.0 would drop the wave-2 arm; deriving
  it keeps wave-2 packages in the released-version macros and marks
  the wave-1-only comparisons correctly.
- A reason class the freeze does not declare: `trivial-reasons.csv`
  is checked against the four frozen classes plus `unclassified`; a
  fifth class fails, so a classifier change cannot smuggle a new
  category into the paper.
- A quoted CSV field split on the comma: `contract-probes.csv`
  RFC-4180 quotes its `reason` column, so a plain split would misread
  it; `readQuotedCsv` handles the quoted form and a doubled quote
  inside it.
- A probe the freeze does not declare: every probe id in
  `contract-probes.csv` is checked against `scripts/exp/probes.json`,
  and the row's `class` must equal the frozen kind. A new probe or a
  renamed kind fails instead of silently entering the counts.
- A missing or duplicated probe cell: every pinned artifact in
  `versions.json` must appear exactly once per frozen probe; a gap or
  a double row fails by name, so the honest-variant counts can never
  come from a partial matrix.
- An `outside_contract` flag that disagrees with `result`: the flag
  must be `yes` exactly on outside-contract rows. A mismatch fails,
  so a non-result can never be counted as a held or a failed
  promise.
- Acceptance counted on the wrong rows: honest acceptance counts a
  released grader that failed none of its promised honest variants,
  and exploratory, not-runnable and outside-contract cells never
  count either way; forged acceptance counts a released grader where
  any `atk-forged-` probe failed its frozen rule. A grader with no
  promised variant still counts as accepted, which is the rule the
  soundness text cites.
- Stale output: the generated file is a pure function of the inputs.
  `--check` regenerates it in memory and fails when the committed
  file differs, which is what catches "CSV changed, macros not
  regenerated". The header carries a per-source sha256 line so the
  drift shows in the diff itself.
- A macro used in text but never generated: `--check` scans every
  `.tex` file under `paper/` for `\exp<Uppercase...>` tokens and
  fails listing the undefined ones. The pattern needs a capital
  letter after `exp`, so the TeX primitive `\expandafter` cannot
  false-positive. The scan is deliberately literal, so a comment
  mention counts as a use: it can over-report, never under-report.
- Nondeterministic output: no timestamps or environment reads; two
  runs on the same tree are byte identical, which the test verifies
  by regenerating and diffing.
- `make pdf`/`make dmlr` on a stale generated file: the build itself
  would still succeed because the file exists, so the drift check is
  what guards this; `macros.test.sh` runs it before building.
- A `.tex` macro collision: the file only emits `\newcommand{\exp...}`
  lines and the prefix is reserved for this generator, so a
  hand-defined `\exp*` elsewhere surfaces as a TeX error in the
  build step.

E2 exploit macros (`\expExpl*`, added with the F3/T3 PR):

- A result row that cannot join the frozen list: a/b rows cite an
  `exploits.csv` line number whose package and locator must match;
  part-c rows consume one frozen row per
  (package, locator, measured_state, record_value) key because the
  six crm-truthfulness issue-9 rows share the first three. A dangling
  row fails by name.
- A verdict outside the frozen sets: `replicated`, `not-replicated`,
  `fix-holds`, `fix-fails`, `not-runnable` for a and b; `replicated`,
  `not-replicated`, `not-runnable` for c, whose `postfix_holds` must
  stay `n/a`.
- A wave-2 row at a version it never had: wave-2 packages released
  only 0.1.0, so a wave-2 result at 0.2.0 fails instead of entering
  the after-fix counts.
- A duplicate or missing measurement: the same (frozen row, version)
  pair twice fails; a frozen row that produced no result and is not
  `needs-reviewer-policy` fails too, so the `\expExplPolicyOnly`
  count cannot hide a skipped run.
- An honest re-check counted as an attack: the record-value rule in
  `exploits-clauses.mjs` splits attack rows from honest-answer
  re-checks (positive record, zero record, or a `not stated` record
  with an `equals oracle` clause), so the attack medians
  (`\expExplAtkMedianOld`, `\expExplAtkMedianNew`, the `\expExplAtk*`
  maxima) never mix the two kinds.
- A record value that does not parse: `parseRecordValue` throws on a
  form it does not know, so a new record style stops the run rather
  than entering a median as zero.

T3 (`exploit-verdicts.tex`, emitted beside the macros):

- A dropped or miscounted clause: the bad-rows block lists every
  not-replicated and fix-fails clause with package, locator, version
  and measured number, sorted by frozen line. A duplicated result row
  trips the duplicate-measurement guard (`macros.test.sh` doctors
  `exploit-results-a.csv` and expects the run to fail); a frozen row
  with no result at all trips the coverage guard unless it is a
  `needs-reviewer-policy` row.
- A fix-fails row softened: the block prints the verdict verbatim
  from the CSV, and `\expExplFixFails` counts them in the caption.
- The float unwired: `macros.test.sh` requires exactly one
  `\input{generated/exploit-verdicts.tex}` in each main file, and
  `--check` flags a stale or missing file.
