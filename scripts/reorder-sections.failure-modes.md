# Failure modes: reorder sections for v2 (C1)

Written before the reorder. Every way the move, the stub sections, or
the verification script can fail, and the check that catches it.

## Dangling references

- A `\section` carrying `\label{sec:engine}`, `sec:suite`,
  `sec:validity`, or `sec:validation` leaves the main text; every
  `Section~\ref{...}` that still names the old label either prints `??`
  or points at the wrong kind of division. Fix: rename the labels to
  `app:engine`, `app:suite`, `app:validity`, `app:validation` on the new
  appendix sections, retarget every caller, and change `Section~` to
  `Appendix~` where the target is now an appendix.
- `sections/index.tex` is cut; it defines no labels, but its `\input`
  must leave `main.tex`, `main-dmlr.tex`, and `scripts/arxiv.mjs`
  together or one build fails.
- Check: compile `make pdf` and `make dmlr`, grep the log for
  `undefined`/`multiply defined`, extract the PDF text and grep for
  `??`. Also grep the .tex tree for `ref{sec:engine}`, `ref{sec:suite}`,
  `ref{sec:validity}`, `ref{sec:validation}` after the fix pass; the
  only survivors should be none.

## arXiv packet misses a file

- `scripts/arxiv.mjs` fails when `main.tex` inputs a path that is not in
  `INPUTS`, and silently ships a broken packet when a section file
  itself contains `\input{generated/...}` or `\input{figures/...}`:
  `flattenInput` rewrites CSV paths only, never nested inputs, so the
  flattened file would name a directory that is not in the tarball.
  Rule: every `\input` of a `generated/` or `figures/` file stays in
  `main.tex`; new appendix section files contain prose and their own
  `\section` line only.
- Check: `make arxiv` both flattens and recompiles the packet.

## Appendix lettering drift

- `\appendix` sits at the top of `sections/appendix.tex`. Any section
  file input before it is a numbered section, not a letter. Keep
  `appendix.tex` first in the appendix block.
- Plan order is A protocol, B per-package graders, C validity,
  D engine surfaces, E review-record statistics, F builders and
  disclosure, G locators, H mock separation, I experiment specs,
  J reproducibility, K deviation log. The letter a `\ref` prints is the
  position in the file; skipping a planned appendix shifts every later
  letter, so E, I, and K get compiling stubs until their content PRs
  land.
- Check: extract the PDF outline (or TOC-less appendix headings) and
  read the letters.

## Build breakage

- `main-dmlr.tex` must mirror the body of `main.tex` exactly (it adds
  keywords, `\impact`, `\acks`, and keeps `\bibliography` without a
  style line). `scripts/dmlr.test.sh` builds from a clean `git archive`
  of HEAD, so uncommitted work is not covered: commit before trusting
  it.
- Stub sections must compile in both styles: plain sentences, no
  special characters, and a `% TODO(<PR>)` comment each.
- Check: `make pdf`, `make dmlr`, `bash scripts/dmlr.test.sh`.

## Text drift during the move

- The PR is pure moves; a stray keystroke in a moved paragraph is a
  silent content change. Check: `scripts/moved-text-check.mjs`
  concatenates the section text before and after (from `git show HEAD:`
  and the worktree), normalises away headings, labels, comments, and
  reference targets, and asserts the only deltas are the cut
  `index.tex` paragraphs minus the one kept sentence, the added stub
  sentences, and nothing else.
- `generated/*.tex` is produced by `scripts/collect.mjs`; do not edit
  it. Check: `node scripts/collect.mjs` then `git status` shows no diff
  outside `collectedAt`.

## Floats stranded

- `[t]` floats and longtables move with their inputs; a table can land
  in a section that no longer discusses it. `generated/builders.tex`
  moves to App F but `adversarial.tex` and `closing.tex` still cite
  `Table~\ref{tab:builders}`; the number still resolves, only the
  position changes.
- Check: render every page of `main.pdf` to an image and look for a
  float sitting in a section that never names it.

## Stubs that say too much

- Placeholder sentences must not claim a finding. Each stub says only
  that the section is a placeholder; the TODO comment names the PR that
  fills it.

## Verification command

One end-to-end pass builds all three artifacts and greps for `??`:

```bash
node scripts/moved-text-check.mjs
make pdf dmlr arxiv
bash scripts/dmlr.test.sh
pdftotext paper/main.pdf - | grep -n '??'
```
