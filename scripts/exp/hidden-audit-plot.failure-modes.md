# Hidden-split audit figure (F8) failure modes

Every way the F8 pipeline can fail, written before the code.
`scripts/exp/hidden-audit-plot.mjs` projects
`paper/data/exp/tarball-audit.csv`, `paper/data/exp/hidden-census.csv`
and `paper/data/exp/hidden-overlap.csv` into the figure inputs under
`paper/generated/`: `hidden-audit-leaks.csv` (one row per artifact x
leak-kind cell: x, y, count), `hidden-audit-rows.csv` (row labels),
`hidden-audit-cols.csv` (leak-kind column labels),
`hidden-audit-overlap.csv` (one row per census-qualified artifact x
frozen seed: jittered x, prompt/expected/id overlap shares in
percent) and `hidden-audit-macros.tex` (axis bounds, wave boundary).
`scripts/exp/hidden-audit-plot.test.sh` is the end-to-end check; each
row says which guard catches it.

- Missing or truncated input CSV: `readCsv` fails naming the path or
  the bad row. Nothing is emitted from partial data.
- Header drift: all three inputs get an exact header check, so a
  renamed or reordered column in a regenerated audit cannot silently
  shift fields into the wrong figure cell.
- A leak kind with no cells: the leak grid is exactly the three kinds
  the issue names (hidden-named files, answer-bearing files, doc
  hidden-seed examples), in that order. An empty kind still renders
  as an all-zero column; it is never dropped.
- A package with no row: every pinned artifact in
  `scripts/exp/versions.json` must appear exactly once in
  `tarball-audit.csv` and `hidden-census.csv`. A missing, duplicated
  or unpinned artifact fails by name before any cell is drawn.
- Semicolon lists miscounted: `hidden_named_files`,
  `answer_bearing_files`, `doc_seeds` and `doc_hidden_seed_examples`
  are `;`-joined lists where `none` means empty. The counter splits
  on `;` and treats the bare token `none` as zero; a cell containing
  only whitespace or an empty entry after a split fails loudly, so a
  formatting drift cannot be read as a count of one.
- A doc seed example counted as a shipped-file leak: the figure keeps
  the three kinds in separate columns and the caption says doc seed
  examples are documentation observations, so a documentation string
  is never presented as a file inside the tarball.
- A census-qualified artifact with no overlap rows (or the reverse):
  the overlap panel reads only artifacts where `hidden-census.csv`
  says `qualifies` is `yes`, and each must have exactly one row per
  frozen seed in `scripts/exp/hidden-seeds.json`. A qualifies flag
  drift, a dropped seed or an extra row fails by name; a phantom
  fourth column can never appear.
- Overlap share above 100 percent: prompt and expected shares divide
  by their `*_pairs` denominators and the id share divides by
  `min(hidden_tasks, public_tasks)`; any share outside 0..100 fails,
  so a denominator bug shows up instead of drawing off-scale points.
- Exact vs normalised overlap confused: the figure plots the exact
  counts only (`prompt_exact_overlap`, `expected_exact_overlap`,
  `id_suffix_overlap` for the id panel since `id_exact_overlap` is
  the strict test and is flat zero). The caption names which columns
  feed it; the normalised columns stay available in the CSV but are
  never silently swapped in.
- Exploratory wave-2 rows read as before/after: accessibility-fix is
  wave 2 and its row sits below the dashed wave rule in the leak
  panel and is labelled in the overlap panel; the caption says the
  wave-2 numbers are exploratory.
- Wide labels: `package@version` row labels and the four qualified
  artifact labels come from generated CSVs, set in `\tiny` and
  rotated where needed; the test renders both figure pages at 80 dpi
  and greps the build log for overfull boxes.
- Grayscale legibility: the leak matrix shades white to a mid grey
  ramp with the count printed in every cell, and the overlap metrics
  use three marker shapes (not only colour), so both panels read
  without colour.
- Stale figure data: the test regenerates every output twice, diffs
  the sha256 lists, and fails when `git status` shows uncommitted
  files under `paper/generated/`.
- Axis bounds typed into .tex: row count, wave boundary, qualified
  count, overlap axis maximum and tick lists come from
  `hidden-audit-macros.tex`, regenerated from the same data.
