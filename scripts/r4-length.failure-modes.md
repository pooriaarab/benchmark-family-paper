# Failure modes: the r4 length pass (issue #227)

What can break, and the check that catches it first.

1. A moved float loses its label or its reference. The e2e requires
   `tab:exploit-verdicts`, `tab:trivial` and `fig:ladder` to appear in
   `app-results.tex`, requires `tab:suite-full` in the appendix block
   of `main.tex`, and greps the built text for `??`.
2. A reference dangles because the input moved. `make pdf`/`make dmlr`
   run twice and fail on `undefined` in the log or `??` in the
   extracted text.
3. The repetition rules regress. The e2e counts `both directions`,
   `\councilMergedApproved` and `\councilSeverityPrsRead` uses across
   the main-matter sources and fails when they repeat.
4. Process detail creeps back. The e2e fails on `chair account`,
   `pull request \approvalSycophancyPr`, the `r$n$` row mechanism and
   csv filenames in the five float captions.
5. The merged paragraphs drift. Greps require the folded
   "What the measured numbers still do not show" paragraph, the single
   §8.1 paragraph, and the claim-table paraphrases.
6. The short/full suite tables drift from the record. The e2e
   re-runs `collect.mjs --from-json`, diffs the generated outputs, and
   counts the short table's five columns and the full table's nine.
7. The build regresses: both PDFs build twice under a fixed epoch with
   identical sha256, with no overfull box, no `Float too large`, and
   the References heading must start by page 12.
8. `dmlr.test.sh` re-verifies the clean-checkout DMLR build.
