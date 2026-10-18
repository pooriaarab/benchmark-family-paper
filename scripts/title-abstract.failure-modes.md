# Failure modes: title, abstract, intro, conclusion (C8)

Written before the edits. Every way the title, abstract, introduction
and conclusion rewrite can fail, and the check that catches it.

## A claim the data does not support

- Every count in the edited text is a macro (`\suite*`, `\council*`,
  `\review*`, `\defect*`, `\trivial*`, `\exp*`, `\approvalDefectCases`,
  `\note*`). `node scripts/exp/macros.mjs --check` fails on an `\exp*`
  name that is not generated; the digit grep catches a numeral typed by
  hand (version labels 0.1.0 and 0.2.0, ISO dates, the issue number 8
  inside "issue 8", and the pelican prompt date are allowed tokens).
- The title keeps "22 Cases"; the grep checks the title still says 22
  while `\suitePackages` is 22, so the title and the data cannot drift
  apart silently.
- No claim from "Claims we do NOT make": no "independent" for the
  author-configured reviewer sessions, no leaderboard, no real-model
  claim, no before/after on wave 2, no "the council does not work".
  The banned-word and em-dash greps fail the build on each.
- The two documented approval-to-defect cases are stated as exactly
  `\approvalDefectCases`, never as a pattern across all approvals.
- The free-model run is named unfinished with no cell count.

## An abstract that breaks the submission

- The arXiv abstract limit is 1920 characters; the test measures the
  rendered text of the abstract and fails above it.
- `main.tex` and `main-dmlr.tex` must carry the same abstract
  paragraph for paragraph: the test diffs the two abstract bodies
  after stripping comments and whitespace.
- `scripts/arxiv.mjs` flattens the paper for the packet; it inputs the
  same generated macros, so a macro the packet cannot resolve is
  caught by rebuilding the arxiv target? The packet compiles
  `main.tex`; the test greps both built PDFs for `??`.
- No PR or council mechanics in the abstract: the test fails on the
  patterns `pull request`, `PR #`, `issue`, `council` appearing inside
  the abstract environment.

## Lost references and stale bookkeeping

- Every `\ref` used in the edited files (`sec:review`, `sec:prereg`,
  `sec:soundness`, `tab:defects`, `fig:system`, `fig:rounds`,
  `app:protocol`, `app:locators`, `app:validity`, `app:validation`,
  `app:engine`, `app:suite`, `app:builders`, `app:deviations`) must
  resolve; pdftotext on both PDFs must show no `??` outside the
  allowed `?? "` verbatim listing.
- The conclusion drops the council-count recap: the test fails if the
  conclusion still names review counts beyond the single
  `\approvalDefectCases` sentence the plan keeps.
- The Willison credit moves out of the introduction to the appendix:
  the test greps that `willison2024pelican` is not cited in intro.tex
  and is cited in the appendix file that keeps it.
- The five checks stay a five-item enumerate; the test counts the
  `\item` entries.

## Reproducibility of the check itself

- `scripts/title-abstract.test.sh` builds both PDFs twice under
  `SOURCE_DATE_EPOCH=1729000000` and fails if the sha256 pair differs.
- `node scripts/collect.mjs` must leave no diff except `collectedAt`.
- The runtime macros come from `paper/data/exp/runtimes.csv`, a
  measured file; the test regenerates the macros and fails on drift.
- The test renders the first page and the conclusion page of each PDF
  so a human can review the rendered output.
