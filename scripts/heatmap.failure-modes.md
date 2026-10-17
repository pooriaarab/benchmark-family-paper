# Defect heatmap (F2) failure modes

Every way the F2 pipeline can fail, written before the code.
`scripts/collect.mjs` generates `paper/generated/defects-heatmap.csv`
and `paper/generated/defects-heatmap-classes.csv` from
`paper/data/defects.csv` and `paper/data/review-rounds.csv`;
`scripts/heatmap.test.sh` is the end-to-end check and each row says
which check catches it.

- A class with no packages: an empty `packages` field would draw a
  phantom column. The collector fails on an empty list.
- A class claiming more than its package list: `at_least` below the
  number of listed (and located) packages is inconsistent. The
  collector fails.
- `score_material` left blank or holding a value other than `yes`/`no`:
  the collector fails instead of silently counting or dropping a class.
- The same package twice inside one class: the collector fails.
- A package with no class: latency-budget is the real case; its row
  stays empty on purpose and `\defectNoClassPackages` names it in the
  caption so the text never types the name.
- A package in `defects.csv` missing from `review-rounds.csv`: the row
  and its margin bar cannot be placed, so the collector fails instead
  of dropping the cell.
- A package in `review-rounds.csv` missing from the suite: the row
  label would name a package the paper never introduces; the collector
  fails against `suite.json`/`suite.txt`.
- Rounds missing or non-integer in `review-rounds.csv`: `reviewTex()`
  already fails; `readCsv` fails on a missing file.
- Wide labels: 13 rotated class ids on the x axis and 22 package ids on
  the y axis can overflow the margins or the column in either build;
  `heatmap.test.sh` renders the figure pages at `pdftoppm -r 80` in the
  NeurIPS and DMLR PDFs and greps the build logs for overfull boxes.
- Cells and labels drifting apart: class order, label text and the
  score-material `*` marker all come from the same `defects.csv` rows,
  and package order and bar heights come from `review-rounds.csv`, so a
  reorder cannot desynchronize axes and data. The test asserts the cell
  grid is exactly classes times packages.
- Margin bars misaligned with rows: the bars axis shares the heatmap's
  y limits and height with `scale only axis`, so the check is visual;
  the test renders both PDFs to PNG and the sha256 pins the pixels.
- Dangling references: `fig:defects` and `fig:rounds` both live on the
  replacement figure; the test greps both build logs for undefined
  references.
- Grayscale legibility: cells use one dark hue against white and the
  margin bars a second dark shade; the test renders PNGs which the
  reviewer checks in grayscale.
- Generated-file drift: `node scripts/collect.mjs --from-json` must
  leave `git status` clean for `paper/generated/`, and a full
  `node scripts/collect.mjs` must move only `collectedAt`.
