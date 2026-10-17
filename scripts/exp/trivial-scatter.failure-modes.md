# Trivial scatter (F5) failure modes

Every way the F5 pipeline can fail, written before the code.
`scripts/exp/trivial-scatter.mjs` generates
`paper/generated/trivial-scatter.csv` (wave-1 points) and
`paper/generated/trivial-scatter-rug.csv` (wave-2, 0.1.0-only lane)
from `paper/data/trivial.csv`, `paper/data/exp/trivial-headroom.csv`
and `scripts/exp/versions.json`. `scripts/exp/trivial-scatter.test.sh`
is the end-to-end check; each row says which guard catches it.

- Missing or truncated input CSV: `readCsv` fails naming the path or
  row. Nothing is emitted from partial data.
- Header drift: a renamed or reordered column fails the exact header
  check, so a changed battery layout cannot silently shift fields.
- Unpinned artifact: every (package, version) in the headroom data is
  checked against `versions.json`. A CSV row outside the pin list
  fails instead of widening the figure.
- Missing released-version row: a package without a headroom row at
  its highest pinned version fails instead of plotting a phantom 0.
- E1/record divergence: for wave-1 packages the headroom bests are
  compared against `paper/data/trivial.csv` (`old` = 0.1.0, `new` =
  0.2.0) within 0.001. A divergence fails the generator: the figure
  is the registered measurement, not two different stories.
- Wave-2 plotted as a real 0.2.0 point: wave-2 has no 0.2.0 release.
  The generator emits them to a separate rug CSV and the figure draws
  them on a lane below the x axis (y = -0.05), never at y = 0, so no
  fabricated zero enters the plot.
- Overplotted origin: up to 9 wave-1 packages sit exactly at (0,0).
  The generator puts an `N at origin` annotation on one cluster row
  instead of drawing N overlapping dots; the count is computed, never
  typed into the .tex.
- Stale figure data: the test regenerates the CSVs and fails when
  `git status` shows uncommitted output — a changed CSV must come
  with a regenerated projection.
- Wide/overlapping labels: labels come from a `label` column, not
  from per-point heuristics; the test renders both figure pages at
  80 dpi for visual review and greps the build logs for overfull.
- Grayscale legibility: wave 1 uses one hue, wave 2 a second, the
  y = x line is dashed black, and the rug lane is a dotted rule; the
  render check produces PNGs which the reviewer checks in grayscale.
- Wrong coordinate source: y comes only from `best_trivial` at 0.2.0
  for wave 1; wave-2 rows never produce a y. A missing best_trivial
  on a pinned artifact fails the generator, not the plot.
