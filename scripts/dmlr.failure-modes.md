# DMLR build failure modes

Every way the DMLR main-paper build fails, written before the code.
Supplement-specific failure modes land with the supplement pull request.

- Style URL moved or archive re-issued: `fetch-dmlr-style.mjs` fails on a
  non-200 or a SHA-256 mismatch against the pinned hash.
- `dmlr2e.sty` not found: `paper/dmlr/` is gitignored, so a clean checkout
  has no style until `make dmlr` runs the fetch; dropping the
  `\input@path` line makes `\usepackage{dmlr2e}` fail.
- Package clash: `dmlr2e.sty` loads `natbib`, `hyperref`, `graphicx`,
  `epsfig`, and `amssymb` itself; loading any of them again in the
  preamble errors. Options must go through `\PassOptionsToPackage`.
- Abstract drift: the abstract in `main-dmlr.tex` must stay identical to
  `main.tex` (1882 rendered characters); diff the two blocks.
- Missing generated macro or table: `\input{generated/...}` files come
  from `scripts/collect.mjs`; a renamed macro fails the build with an
  undefined control sequence.
- `\editor`, `\dmlrheading` or `\openreview` handling: without the
  `preprint` option an unset `\editor` errors; `\openreview` is always
  required by `\@maketitle`.
- Column-width overflow: DMLR's `\textwidth` is 6.0in, wider than the
  NeurIPS measure, but `p{}` fractions and long `\texttt` runs can still
  overflow; check every page as an image (`pdftoppm -r 60`).
- NeurIPS build regression: `make pdf` and `make arxiv` must still pass;
  `node scripts/collect.mjs` must produce no diff except `collectedAt`.
