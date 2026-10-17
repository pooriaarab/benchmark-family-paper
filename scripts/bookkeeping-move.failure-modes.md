# Failure modes: move review bookkeeping to the appendix (C2)

Written before the edits. Every way the moves, the trims, the new
generated table, or the verification script can fail, and the check
that catches it.

## Broken or orphaned references

- Moved paragraphs carry `\ref{tab:builders}`, `\ref{tab:defects}`,
  `\ref{tab:suite}`, `\ref{app:protocol}`, `\ref{app:locators}`,
  `\ref{sec:review}`, `\ref{sec:prereg}` and `\ref{fig:rounds}`. None of
  the moved text defines a `\label`, so labels cannot be orphaned; a
  `\ref` can only break if its target file stops being input. No
  `\input` line is removed, so every target survives.
- `\paragraph{...}` headings move with their bodies and compile the
  same way inside an appendix `\section`.
- New pointers `Appendix~\ref{app:reviewstats}`,
  `Appendix~\ref{app:builders}`, `Appendix~\ref{app:deviations}` are
  added where the moved text used to sit; a typo prints `??`.
- Check: `scripts/bookkeeping-move.test.sh` builds both PDFs, greps
  the logs for `undefined` references and citations, and greps the
  extracted text for `??`.

## A counted number typed by hand

- The App E table of approval-to-defect commits must come from
  `paper/data/approval-defects.csv`, so `scripts/collect.mjs` grows an
  `approvalDefectsTex()` writer for `generated/approval-defects.tex`;
  the file is never edited by hand.
- The one clause naming the agent mix must come from
  `paper/data/builders.csv`, so `collect.mjs` also emits
  `\builderAgents`, `\builderTopAgent` and `\builderTopAgentPrs`. If a
  row is added to builders.csv the clause follows the data.
- Check: `node scripts/collect.mjs` twice; the second run must leave
  the worktree clean except `collectedAt` in `suite.json`.

## A moved number disappearing

- The trims are named by the plan: the regex detail, the council
  bookkeeping, the builder table text and the deviation list move to
  appendices; the index-entry sentences and the repeated changelog
  argument are cut. Everything else keeps its macro. A hand audit of
  `git diff` greps every deleted line for `\<macro>` and confirms the
  same macro still appears in the post-edit tree.
- Check: `git diff -U0 | grep '^-' | grep -o '\\[a-zA-Z]*'` listed
  against the surviving files.

## Appendix lettering drift

- The stubs already hold the letters: filling `app-review-stats.tex`
  (E), `app-builders.tex` (F), `app-reproducibility.tex` (J) and
  `app-deviations.tex` (K) adds prose inside existing `\section`s and
  cannot shift letters. No new `\section` is added.
- Check: extract the PDF text and read the appendix headings.

## arXiv packet misses the new generated file

- `scripts/arxiv.mjs` flattens only the paths in `INPUTS`, and section
  files must not `\input` generated files themselves, so
  `\input{generated/approval-defects.tex}` goes in `main.tex` and
  `main-dmlr.tex` directly after `sections/app-review-stats.tex`, and
  `["generated/approval-defects.tex", "approval-defects.tex"]` goes in
  `INPUTS`. Check: `make arxiv` flattens and recompiles the packet.

## DMLR mirror drift

- `main-dmlr.tex` inputs the same section and generated files as
  `main.tex`; the new `\input` line must land in both.
  `scripts/dmlr.test.sh` builds from `git archive HEAD`, so commit
  before trusting it.
- Check: `bash scripts/dmlr.test.sh`.

## Sentence-level drift during a move

- The PR is moves plus the named trims. Moved paragraphs are copied
  verbatim; the sentences that change are only the ones the plan names
  (opening pointer sentences, the single-sentence changelog argument,
  the three-sentence AI disclosure, the footnote DOI chain, the
  index-entry cuts). Everything else must be byte-identical.
- Check: read the full `git diff` of `sections/`; every hunk is either
  a deletion, an addition in an appendix file, or one of the named
  sentences.

## Verification command

One end-to-end pass builds both PDFs, checks for undefined references
and citations, and prints the artifact hashes:

```bash
make bookkeeping-test
```
