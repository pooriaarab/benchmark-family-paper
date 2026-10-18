# Failure modes: limitations section and claim table (C7)

Written before the edits. Every way the Section 8 rewrite
(`sections/closing.tex`) can fail, and the check that catches it.

## A claim the data does not support

- Every count in the rewrite is a macro (`\suite*`, `\council*`,
  `\review*`, `\defect*`, `\trivial*`, `\exp*`, `\approvalDefectCases`,
  `\note*`). `node scripts/exp/macros.mjs --check` fails on an `\exp*`
  name that is not generated, and `collect.mjs` covers the rest; the
  digit grep catches a numeral typed by hand (version labels 0.1.0 and
  0.2.0 and ISO dates are allowed tokens).
- No sentence says the fixes removed the defects: the fix-fails clauses
  are reported as found, so the table and the text name the surviving
  `\expExplFixFails` clauses.
- Wave 2 is called exploratory wherever its numbers appear, and no
  sentence compares a before and an after for a wave-2 package.
- The reviewer sessions are agent sessions the author configured; the
  banned-word grep fails the rewrite if "independent" describes them.
- No claim about any real model: the registered arm is named unfinished
  and the partial free-model cells are named as outside this
  repository, with no cell count reported.
- The `\expExplPolicyOnly` frozen exploit rows that need the reviewer's
  unreleased policy are named as a gap, not silently dropped.
- The selection caveat stays: the defect table is built from the
  probing record, so "probing found them" is partly true by
  construction.
- No leaderboard, no "novel", "robust", "comprehensive", no "first" as
  a claim, no em dash or en dash, no "X, not Y" slogan.

## A table that lies or does not fit

- Table `tab:claimgap` gains the data file behind each claim; a file
  name that does not exist in the repository is caught by the test's
  existence check on every `\texttt{}` token ending in `.csv`, `.json`
  or `.jsonl`.
- Four narrow columns can overflow; the build log is checked for
  `overfull` and the rendered page is inspected as an image.
- The table keeps `\label{tab:claimgap}` and stays a single counted
  float; a dropped label prints `??` in the extracted text.

## Lost or orphaned references

- Every `\ref` used in the rewrite (`tab:defects`, `tab:trivial`,
  `tab:mock`, `tab:exploit-verdicts`, `fig:rounds`, `fig:exploits`,
  `fig:probes`, `fig:hiddenaudit`, `fig:ladder`, `sec:review`,
  `sec:prereg`, `sec:soundness`, `app:protocol`, `app:reviewstats`)
  must exist; pdftotext on both PDFs must show no `??` outside the
  allowed `?? "` verbatim listing.
- `closing.tex` stays the only input under the Limitations section in
  both `main.tex` and `main-dmlr.tex`; the abstract blocks are not
  touched, so `scripts/dmlr.test.sh` still passes.

## Reproducibility of the check itself

- `scripts/limitations.test.sh` builds both PDFs twice under
  `SOURCE_DATE_EPOCH=1729000000` and fails if the sha256 pair differs.
- `node scripts/collect.mjs` must leave no diff except `collectedAt`.
- The test renders the limitations page of each PDF to a PNG so the
  table layout can be eyeballed, not only grepped.
