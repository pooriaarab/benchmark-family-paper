# Failure modes: scripts/pkg-reports.mjs

Written before the generator: every way it can fail, and the response.

## Inputs and data
1. **Unknown package.** Not `all` or a `zenodo-dois.json` key: fail with
   the known list.
2. **Missing suite row.** `benchmark-core` has no `suite.json` row: fail
   naming the file and key; a later brief can extend the data model.
3. **Missing data row.** No row in `review-rounds.csv` or
   `council-prs.csv` fails naming the file. Missing `trivial.csv` /
   `approval-defects.csv` rows are not errors: the report prints the
   "not part of the preregistered check" / no-case-listed statements.
4. **Number mismatch.** `taskCount` differs from the `kinds` sum, or
   cached `package.json` version differs from the suite version: fail
   with both values, never pick one.
5. **Cache stale or absent.** GitHub files land in `reports/.cache/`
   with a `_fetchedAt` stamp; `--refresh` refetches; the cache date is
   printed every run.
6. **Rate limit / network down.** A non-200 fetch fails naming URL and
   status; a warm cache still generates.
7. **README without a question line.** The first lead paragraph that
   says what the package measures or asks is quoted; if none qualifies,
   or every candidate carries banned wording, fail. Never paraphrase.
8. **Grading doc absent.** Quote `docs/grading.md`'s first paragraph or
   fail.
9. **Claim with no source.** Every printed number is a `\pkg*` macro
   with a `% source:` comment; every package-specific sentence is a
   verbatim quote block with a `% quote:` locator. The test checks both.
10. **Banned wording.** Authored prose must not contain "independent",
    "novel", "first", "robust", "comprehensive", an em dash, or an
    "X, not Y" slogan. The test greps outside quote blocks.

## Outputs

11. **PDF overflow.** Overfull boxes are caught by `pdftoppm` review;
    long verbatim lines get invisible `\allowbreak` breakpoints the test
    strips before comparing.
12. **Abstract over 1920 or under 100.** Asserted before write;
    `paper-publish check` re-verifies against the PDF.
13. **Title drift.** `meta.json` `title` must equal the page-1 title
    block; a single-line title keeps the block one line.
14. **ORCID hard-coded.** `authors[0].orcid` is `process.env.ORCID_ID`
    or `null`; the publisher fills it.
15. **Repeatability.** Same `--date` and cache give byte-identical
    `report.tex`; the test prints the three SHA-256 sums.
16. **Cache committed.** `reports/.cache/` and PDFs are gitignored; only
    `report.tex` and `meta.json` are committed.
17. **Wrapped lines join without a space.** A `\allowbreak` placed beside
    a space lets the PDF line break eat the space (`planrises`). The wrap
    helper only breaks mid-word or at a real space, and the test re-finds
    each normalised prose quote in the normalised source file.
18. **`--` renders as an en dash.** Two hyphens in text mode are a
    ligature; quote and code text escapes them as `-{}-` inside
    `\texttt` spans or a `\ttfamily` quote block. The test fails on a
    bare `--` outside monospace.
19. **Markdown backticks print as quotes.** `` `x` `` in a quoted line
    becomes `\texttt{x}`; a lone backtick becomes `\textasciigrave{}`.
    The test fails on any backtick inside a quote region.
20. **Code lines merge into one line.** Command and fenced blocks are
    set `\ttfamily` with each source line ended by `\\`; the test
    requires every monospace quote line to be a verbatim source line.
21. **Floats drift out of their section.** Tables use `[H]` (package
    `float`) and the caption sits above the tabular at full width;
    `pdftoppm` review confirms each table stays in the section that
    introduces it and nothing touches the margin.
