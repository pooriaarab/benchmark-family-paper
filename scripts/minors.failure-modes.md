# Review minors: failure modes

Every way this change can go wrong, written before the edits (issue
#214). `scripts/minors.test.sh` is the end-to-end check.

- The check count drifts again: conclusion.tex must read "Four of the
  checks" and name checks two through five; the e2e greps the line and
  forbids "Three of the checks".
- The disclosure pointer goes stale again: closing.tex must name both
  appendices (app:builders, app:reviewstats); the e2e greps for both
  refs on the disclosure line.
- The free-model status is re-described as running: the e2e forbids
  "still running", "still in progress" and "in progress at the time"
  in every section file and requires "was not completed" in
  app-deviations.tex and prereg.tex.
- The ORCID or the availability statement is dropped: the e2e greps
  both title pages for the ORCID and app-reproducibility.tex for the
  concept DOI and the "Data availability." heading.
- Prose regressions: em/en dash, banned words and the "X, not Y"
  slogan shape are grepped on the touched files.
- Build or reference breakage: both PDFs build twice under a fixed
  epoch with identical sha256 and no ?? in the text; the changed
  pages render to PNG. scripts/dmlr.test.sh runs last on a committed
  tree.
