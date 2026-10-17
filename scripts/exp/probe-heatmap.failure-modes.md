# Probe heatmap (F7) failure modes

Every way the F7 pipeline can fail, written before the code.
`scripts/exp/probe-heatmap.mjs` projects
`paper/data/exp/contract-probes.csv` into the figure inputs under
`paper/generated/`: `probe-heatmap.csv` (one row per artifact x probe
cell), `probe-heatmap-cols.csv` (column labels), `probe-heatmap-rows.csv`
(row labels), `probe-heatmap-fails.csv` (per-row fail counts for the
margin bars), `probe-heatmap-hatch.tex` (pattern fills for
outside-contract and not-runnable cells) and `probe-heatmap-macros.tex`
(axis bounds and group separators). `scripts/exp/probe-heatmap.test.sh`
is the end-to-end check; each row says which guard catches it.

- Missing or truncated input CSV: `readCsv` fails naming the path or
  row. Nothing is emitted from partial data.
- Header drift: a renamed or reordered column fails the exact header
  check, so a changed runner layout cannot silently shift fields.
- A probe class with no cells: the column order derives from
  `scripts/exp/probes.json` kinds (honest-variant, then
  unpromised-exploratory, then attack). A CSV that drops a probe, or a
  probes.json that adds one, fails a coverage check in both directions
  before any figure is drawn.
- A package with no row: every pinned artifact in
  `scripts/exp/versions.json` must appear exactly once per probe
  column. A missing or duplicated cell fails by name; a phantom row
  can never render as an empty stripe.
- An unexpected result token: `result` must be one of `pass`, `fail`,
  `exploratory`, `not-runnable`, `outside-contract`, and the
  `outside_contract` flag must agree (`yes` exactly on
  outside-contract rows). A new token from a changed runner fails
  instead of being coloured in.
- Outside-contract or not-runnable shown as pass or fail: those cells
  carry meta state 0 (white) in the matrix plus a pattern fill from
  `probe-heatmap-hatch.tex` (diagonal lines for outside-contract,
  crosshatch for not-runnable). The generator writes them into the
  hatch file only, never into the pass or fail states.
- Score column misuse: the figure never reads `score`; only `result`
  drives the colour. A probe that ran but scored oddly stays a pass or
  fail by its frozen rule, not by a threshold invented here.
- Exploratory counted as a defect: `exploratory` rows get their own
  light-grey state and are excluded from the fail-count margin bars;
  the bars count `fail` cells only.
- Wide labels: probe ids and `package@version` row labels come from
  generated CSVs, rotated and set in `\tiny`; the test renders both
  figure pages at 80 dpi and greps the build log for overfull boxes.
- Grayscale legibility: pass uses `okblue`, fail `black!85`,
  exploratory `black!15`, and the two non-results are white cells with
  distinct hatch patterns, so all five states separate without colour.
- Stale figure data: the test regenerates every output and fails when
  `git status` shows uncommitted files under `paper/generated/`.
- Axis bounds typed into .tex: column count, row count, wave boundary
  and the fail-bar axis maximum and ticks come from
  `probe-heatmap-macros.tex`, regenerated from the same data.
