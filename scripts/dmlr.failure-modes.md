# DMLR build failure modes

Every way this build fails, written before the code. `scripts/dmlr.test.sh`
is the end-to-end check; each row says which check catches it.

- Style URL moved or archive re-issued: `fetch-dmlr-style.mjs` fails on a
  non-200 or a SHA-256 mismatch against the pinned hash.
- `dmlr2e.sty` not found: `paper/dmlr/` is gitignored, so a clean checkout
  has no style until `make dmlr` runs the fetch; building without it or
  with `TEXINPUTS` unset fails at `\usepackage{dmlr2e}`.
- Package clash: `dmlr2e.sty` loads `natbib`, `hyperref`, `graphicx`,
  `epsfig`, and `amssymb` itself; loading any of them again in the
  preamble errors. Loading `natbib` options must go through
  `\PassOptionsToPackage`.
- Abstract drift: the abstract in `main-dmlr.tex` must stay identical to
  `main.tex` (1882 characters); the test extracts both blocks and diffs.
- Missing generated macro or table: `\input{generated/...}` files come
  from `scripts/collect.mjs`; a renamed macro fails the build with an
  undefined control sequence.
- A supplement row missing: the test greps every package id from
  `paper/data/suite.txt` in the generated access list and counts the
  documentation rows.
- `paper/data/zenodo-dois.json` missing a package or a `record` field:
  `gen-dmlr-supplement.mjs` exits nonzero instead of emitting a row
  without a DOI link.
- Licence claim drift: the supplement states MIT for all 22 repos; if a
  repo relicenses, the claim is wrong. Verified once at authoring time
  with `gh api repos/pooriaarab/<repo>/license` (all MIT, 2026-10-17);
  no live check in the test because the repos can change under us.
- Column-width overflow: DMLR's `\textwidth` is 6.0in, wider than the
  NeurIPS measure, but `p{}` fractions and long URLs can still overflow;
  check every page as an image (`pdftoppm -r 60`).
- `\editor`, `\dmlrheading` or `\openreview` handling: without the
  `preprint` option an unset `\editor` errors; `\openreview` is always
  required by `\@maketitle`.
- Clean-checkout coverage: `dmlr.test.sh` builds from `git archive HEAD`,
  so uncommitted files are invisible to it; commit before running.
- NeurIPS build regression: `make pdf` and `make arxiv` must still pass;
  `node scripts/collect.mjs` must produce no diff except `collectedAt`.
