# Framing rewrite (review M1): failure modes

Every way this change can go wrong, written before the edits (issue
#219). `scripts/framing.test.sh` is the end-to-end check. Touched
files: `paper/main.tex`, `paper/main-dmlr.tex`,
`paper/sections/intro.tex`, `paper/sections/conclusion.tex`.

- The causal "review depth" claim survives under new words: the e2e
  forbids "review depth", "only running the artifact", "only probing
  the running", "only probing found", and any sentence that joins
  "approvals" and "only" in the touched files.
- The null is oversold again: the e2e forbids "caught almost none",
  "missed almost all", "almost none of it" in the touched files, and
  requires the abstract and the intro to carry the non-tied
  denominator (`\trivialSignN`) next to the sign-test result so the
  bound is visible.
- The unsupported task-aware claim returns: the e2e forbids "most
  were found by" and "found by attack policies" in the touched
  files.
- The abstract keeps hiding Section 6 and the open post-fix clauses:
  the e2e requires `\expProbesFailedCells`, `\expProbesReleasedCells`
  and `\expExplFixFails` in both abstracts.
- The counter-evidence drops out: the e2e requires the seed catch
  and the payment-delegation find in both abstracts
  (`\expTrivialReleasedMax` covers the number) and the two
  documented cases as `\approvalDefectCases` of
  `\councilMergedApproved`.
- A hard-typed number sneaks in where a macro exists: the e2e greps
  the touched files for digits outside macro names, versions,
  dates and DOIs.
- Prose regressions: em/en dash, banned words ("novel", "robust",
  "comprehensive", "independent" outside "independent researcher"),
  "X, not Y" slogans and "rubber stamp" are grepped on the touched
  files.
- Build or reference breakage: both PDFs build twice under a fixed
  epoch with identical sha256, no `??` in extracted text, no
  overfull or undefined-reference warnings; the changed pages render
  to PNG. `scripts/dmlr.test.sh` runs last.
