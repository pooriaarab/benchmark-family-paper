# Failure modes: verification-layers section and F1 redraw (C3)

Written before the edits. Every way the new section and the redrawn
figure can fail, and the check that catches it.

## Undefined reference or citation

- The section cites labels that live elsewhere (`sec:review`,
  `sec:prereg`, `fig:system`, `tab:mock`, `app:validation`,
  `app:protocol`). A label that does not exist prints `??` in the PDF
  and a warning in the log.
- Check: `scripts/verification-layers.test.sh` builds both PDFs, greps
  the tectonic logs for `undefined`, `citation` and `overfull`, and
  greps the extracted text of both PDFs for `??`.

## Orphan figure

- `sections/intro.tex` cites `fig:system`, so the redrawn figure must
  keep `\label{fig:system}` and stay input by both `main.tex` and
  `main-dmlr.tex`. Dropping the label or the input leaves a `??`.
- Check: the same `??` scan, plus a grep that `fig:system` still
  labels a figure in `figures/fig-system.tex` and that both mains still
  input the file.

## A counted number typed by hand

- Every count in the new text must come from a generated macro
  (`\councilMergedFeature`, `\councilTestJobFail`,
  `\councilTestJobEverFail`, `\councilMergedApproved`,
  `\councilSeverityPrsRead`, `\reviewPackages`, `\reviewRoundsMedian`,
  `\reviewRoundsMax`, `\trivialPolicies`, `\suitePackages`). The only
  digits allowed as literals are the structural names L1, L2 and L3,
  which are defined terms, not measurements.
- Check: `git diff` on `sections/verification-layers.tex` and
  `figures/fig-system.tex` introduces no bare numeral outside the L1,
  L2, L3 gate names and the ladder rung order.

## Text promising an experiment that is not in the data

- The prompt-reading rung of the ladder is a definition. No measured
  row exists for it in `paper/data/`, so the section must not cite a
  result for it. The blind rung points at Section 5, the task-aware
  rung at Section 4, the oracle rung at Appendix H; each pointer names
  a label present in the tree.
- Check: read the diff; every forward pointer resolves to an existing
  label, and no rung carries a count that has no data file behind it.

## Figure unreadable in grayscale or too wide

- The gates and ladder rungs carry text labels (L1, L2, L3, blind,
  prompt-reading, task-aware, oracle), so the meaning survives without
  colour; the fills differ in luminance on top of that. A too-wide
  picture throws an overfull hbox.
- Check: the log grep catches `overfull`; the figure pages of both
  PDFs are rendered and inspected as images.

## Section length out of budget

- The plan gives Section 3 about 0.75 page. The test reports the
  section's page span in the NeurIPS build so the reviewer sees the
  real number.

## Non-repeatable artifact

- The paper claims reproducibility, so the check builds both PDFs
  twice under a fixed `SOURCE_DATE_EPOCH` and prints the sha256 of
  each build; the two rounds must print the same hashes.

## Verification command

```bash
make layers-test
```
