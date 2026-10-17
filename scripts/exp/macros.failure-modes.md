# Experiment macros failure modes

Every way the macro pipeline can fail, written before the code.
`scripts/exp/macros.mjs` generates `paper/generated/exp-macros.tex`
from the committed experiment CSVs and `scripts/exp/versions.json`;
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
