# Failure modes: scripts/pkg-reports.mjs

Written before the generator: every way it can fail, and the response.

## Inputs and data
1. **Unknown package.** Not `all` or a `zenodo-dois.json` key: fail
   with the known list.
2. **Missing suite row.** `benchmark-core` has no `suite.json` row:
   fail naming the file and key.
3. **Missing data row.** No row in `review-rounds.csv` or
   `council-prs.csv` fails naming the file. Missing `trivial.csv` /
   `approval-defects.csv` rows are not errors: the report prints
   not-part / no-case statements.
4. **Number mismatch.** `taskCount` differs from the `kinds` sum, or
   cached `package.json` version differs from suite version: fail with
   both values, never pick one.
5. **Cache stale or absent.** GitHub files land in `reports/.cache/`
   with a `_fetchedAt` stamp; `--refresh` refetches; the cache date is
   printed every run. `GITHUB_TOKEN`/`GH_TOKEN` authenticate.
6. **Rate limit / network down.** A non-200 fetch fails naming URL and
   status; a warm cache still generates.
7. **README without a question line.** The first lead paragraph that
   says what the package measures or asks is quoted; if none qualifies
   or carries banned wording, fail. Never paraphrase.
8. **Grading doc absent.** Quote `docs/grading.md`'s first paragraph
   or fail.
9. **Claim with no source.** Every printed number is a `\pkg*` macro
   with a `% source:` comment; every package sentence is a verbatim
   quote block with a `% quote:` locator. The test checks both.
10. **Banned wording.** Authored prose must not contain "independent",
    "novel", "first", "robust", "comprehensive", an em dash, or an
    "X, not Y" slogan. The test greps outside quotes.

## Outputs

11. **PDF overflow.** Overfull boxes are caught by `pdftoppm` review;
    long verbatim lines get invisible `\allowbreak` breakpoints the
    test strips before comparing.
12. **Abstract over 1920 or under 100.** Asserted before write;
    `paper-publish check` re-verifies against the PDF.
13. **Title drift.** `meta.json` `title` must equal the page-1 title;
    a single-line title keeps the block one line.
14. **ORCID hard-coded.** `authors[0].orcid` is `process.env.ORCID_ID`
    or `null`; the publisher fills it.
15. **Repeatability.** Same `--date` and cache give byte-identical
    `report.tex`; the test prints the three SHA-256 sums.
16. **Cache committed.** `reports/.cache/` and PDFs are gitignored; only
    `report.tex` and `meta.json` are committed.
17. **Wrapped lines join without a space.** A break hint beside a
    space makes the PDF break eat it (`planrises`). Wrap only mid-word
    or at a real space; the test re-finds each quote in the source.
18. **`--` renders as an en dash.** Escape as `-{}-` inside `\texttt`
    or `\ttfamily`; the test fails on a bare `--` outside monospace.
19. **Markdown backticks print as quotes.** `` `x` `` becomes
    `\texttt{x}` in prose, `\textasciigrave{}` in code; the test fails
    on a backtick in a quote.
20. **Code lines merge into one line.** Code blocks set `\ttfamily`,
    each source line ended by `\\`; each rendered line must be
    verbatim.
21. **Floats drift out of their section.** Tables use `[H]` (`float`),
    captions above the tabular; `pdftoppm` review confirms each table
    stays in its section and nothing touches the margin.
