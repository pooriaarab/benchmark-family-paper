# Failure modes: rewrite the probing section (C4)

Written before the edits. Every way the Section-4 rewrite, the
appendix move, and the Section-5 ladder paragraph can fail, and the
check that catches it.

## A claim the data does not support

- Every count in the rewrite is a macro (`\reviewPackages`,
  `\defectClasses`, `\expExpl*`, `\exploitDumbbell*`,
  `\policyLadder*`, `\council*`, `\approvalDefectCases`,
  `\builder*`). `node scripts/exp/macros.mjs --check` fails on an
  `\exp*` name that is not generated, and `collect.mjs` covers the
  rest; a hand audit greps the new text for a bare numeral that is
  not a version label.
- The fix-fails number stays at five, named through
  `\expExplFixFails` and `\expExplFixFailsPkgs`, and the paragraph
  reports them as found; no sentence may describe the fixes as
  having removed the defects.
- Wave 2 is called exploratory wherever its numbers appear, and no
  before/after claim covers it.
- "Independent" never describes the reviewer sessions; the caveat
  names them agent sessions configured by the author.

## Lost or orphaned references

- The moved itemize detail keeps its `\note*` macros and lands in
  `app-defect-classes.tex` behind `\label{app:defectclasses}`; the
  main file points at it. A typo prints `??` in the extracted text.
- New `\input` lines go in `main.tex` and `main-dmlr.tex` together;
  the e2e greps both for the appendix file.
- `\ref{fig:ladder}` in the Section-5 paragraph requires the
  B5 figure merged; this PR branches after #200 lands.

## A moved number or locator disappearing

- The itemize moves to the appendix so the per-class examples keep
  their sourced minima. `git diff` on `adversarial.tex` shows the
  bullets leaving and the same `\note*` macros surviving in
  `app-defect-classes.tex`.

## Figure or table that does not fit

- The rewrite adds no float: F2, F3, T3, F4 are already placed.
  The e2e rebuilds both PDFs, greps for `overfull` and `undefined`,
  and renders the Section-4 pages for review; page counts are
  printed before and after.

## Prose style regressions

- Humanizer pass: no em dash, no "X, not Y" slogans, no "novel",
  "robust", "comprehensive", no "first" as a claim. The e2e greps
  the edited files for these patterns.

## Stale generated output

- The PR adds no generator; `macros.mjs --check`,
  `exploits-plot.mjs --check` and `policy-ladder.mjs --check` all
  run in the e2e so a drifted generated file cannot pass.

## Verification command

```bash
make probing-section-test
```
