# Failure modes: the r4 facts pass (issue #225)

What can break, and the check that catches it first.

1. A headline count drifts from its counting rule. The fail-cell,
   seed and weak-hold numbers are generated macros; `macros.mjs --check`
   fails on stale output and the e2e recomputes each count from the
   CSVs itself. A claim that no longer matches its rule fails before
   the builds run.
2. The generated TeX carries a control character. A single-backslash
   `\ref` inside a JavaScript template literal once wrote a carriage
   return into the T3 caption ("Table eftab:exploit-verdicts-low").
   `macros.mjs` now fails on any generated .tex byte below 0x20 that
   is not a line feed, at write time and in `--check`.
3. The seed hand-check file disagrees with the audit. `macros.mjs`
   fails when a `detector` row in `seed-check.csv` is not an "other"
   audit value, when a `hand-check` row duplicates one, or when an
   audit "other" value has no verdict row.
4. The two abstracts drift apart. `dmlr.test.sh` diffs the abstract
   of `main.tex` against `main-dmlr.tex`.
5. A moved or rewritten claim loses its evidence. The e2e greps the
   corrected rows and sentences: the claim-table retitles, the weak
   column in T3, the credit-fail abstract sentence, the designed and
   chance credit split in Section 5, and the COI sentence.
6. Typed numerals creep into prose. The e2e strips comments,
   `\texttt{}` and version tokens from the touched section files and
   fails on any surviving digit run, matching the per-section guard
   style of `grader-soundness.test.sh`.
7. Banned prose returns. The e2e greps the touched files for em and
   en dashes, the ", not " slogan shape, and the humanizer's banned
   words.
8. The builds regress: both PDFs build twice under a fixed epoch and
   the sha256 must repeat; undefined refs, `??` in extracted text,
   overfull boxes and "Float too large" warnings fail.
9. `collect.mjs` or the figure generators move their outputs. The e2e
   re-runs them and diffs the sha256 of every generated file.
