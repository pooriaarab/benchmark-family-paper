# Zero-reason stacked bars (F6) failure modes

Every way the F6 pipeline can fail, written before the code.
`scripts/exp/trivial-reasons-plot.mjs` generates
`paper/generated/trivial-reasons-plot.csv` (per-package shares of each
frozen zero class) from `paper/data/exp/trivial-reasons.csv`, ordered
by `paper/data/review-rounds.csv` so the wave boundary matches the F2
heatmap. `scripts/exp/trivial-reasons-plot.test.sh` is the end-to-end
check; each row says which guard catches it.

- Missing or truncated input: `readCsv` fails naming the path or row.
  Nothing is emitted from partial data.
- Header drift: a renamed column fails the exact header check so a
  changed battery layout cannot silently shift fields.
- Unpinned artifact: every (package, version) is checked against
  `scripts/exp/versions.json`; a row outside the pin list fails.
- A class the freeze does not declare: classes are checked against the
  `classMeanings` keys of `scripts/exp/reason-classes.json` plus
  `unclassified`; a fifth class fails instead of silently merging into
  a neighbour bar.
- A package with no zero rows: its bar would be empty. The generator
  emits an all-zero row and the test prints it, so the gap is visible
  rather than hidden by normalisation.
- Division by zero in the share pass: totals are checked per package
  before division; a zero total writes zeroes, never NaN into .tex.
- Share-sum drift: per-package shares are rescaled to sum to exactly
  100.0 (residual corrected on the largest class), so every stacked
  bar reaches the 100 line; a class list change cannot leave
  floating-point crumbs above the axis.
- Order drift: bar order follows `review-rounds.csv` row order, the
  same order the heatmap uses, so the wave separator drawn at
  `\reviewWaveOne` stays aligned with the F2 rows.
- Stale figure data: the test regenerates the CSV and fails when
  `git status` shows uncommitted output.
- Wide labels: 22 rotated package ids can overflow the column in
  either build; the test renders the figure pages at 80 dpi in the
  NeurIPS and DMLR PDFs and greps for overfull boxes.
- Grayscale legibility: classes use one dark fill, two mid hues, one
  light fill and an open white segment, ordered largest-share-first
  so neighbours never share a shade; the render check produces PNGs
  the reviewer can inspect in grayscale.
- Version mixing: counts are pooled over each package's pinned
  versions because the figure asks why rows die, not when; the
  caption states the pooling.
