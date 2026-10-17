# Hidden-split audit figure (F8) failure modes

Every way the F8 pipeline can fail, written before the code.
`scripts/exp/hidden-audit-plot.mjs` projects `tarball-audit.csv`,
`hidden-census.csv` and `hidden-overlap.csv` under `paper/data/exp/`
into the figure inputs under `paper/generated/` (leak-cell grid, row
and column labels, jittered overlap scatter, axis-bound macros).
`scripts/exp/hidden-audit-plot.test.sh` is the end-to-end check; each
row says which guard catches it.

- Missing or truncated input CSV: `readCsv` fails naming the path or
  the bad row. Nothing is emitted from partial data.
- Header drift: all three inputs get an exact header check, so a
  renamed or reordered column cannot shift fields into the wrong cell.
- A leak kind with no cells: the grid always emits the three kinds the
  issue names, in order; an empty kind renders as an all-zero column.
- A package with no row: every pinned artifact in `versions.json`
  must appear exactly once in the audit and the census; a missing,
  duplicated or unpinned artifact fails by name before any cell.
- Semicolon lists miscounted: the leak columns are `;`-joined lists
  where `none` means empty; an empty entry after a split fails loudly.
- Doc seed examples read as shipped leaks: the seed-examples column is
  a documentation observation; the caption says so, and it never adds
  to the shipped-file leak count.
- A qualified artifact with no overlap rows (or the reverse): the
  overlap panel admits only census `qualifies = yes` artifacts, each
  with exactly one row per frozen seed in `hidden-seeds.json`; a flag
  drift, dropped seed or extra row fails by name.
- Overlap share above 100 percent: each share is checked against its
  denominator, so a denominator bug fails instead of drawing off-scale
  points.
- Exact vs normalised overlap confused: only the exact columns feed
  the figure (`id_suffix_overlap` for ids, since `id_exact_overlap` is
  the strict test and is flat zero); the caption names them.
- Exploratory wave-2 rows read as before/after: accessibility-fix sits
  below the dashed wave rule and the caption labels it exploratory.
- Wide labels: row and group labels come from generated CSVs, set in
  `\tiny` and rotated; the test renders both pages and greps the build
  logs for overfull boxes.
- Colour-only reading: the leak matrix prints the count in every cell
  and the overlap metrics use three marker shapes, so both panels read
  in grayscale.
- Stale figure data: the test regenerates every output twice, diffs
  the sha256 lists, and fails when `git status` is dirty.
- Axis bounds typed into .tex: row count, wave boundary, qualified
  count and axis maximum come from `hidden-audit-macros.tex`.
