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
6. **Rate limit / network down.** A non-200 fetch fails naming URL
   and status; a warm cache still generates.
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
    "X, not Y" slogan. The test greps outside quotes for the banned
    words, an em dash, `, not ` and `not of `.

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
22. **Seed attributed to the wrong run.** The public task split has a
    generator seed; `collect.mjs` runs the mock at its own seeds. A
    sentence that names one for the other misstates the record, so the
    report keeps separate macros (`\pkgMockSeedA`, `\pkgMockSeedB`
    sourced to `scripts/collect.mjs`, `\pkgPublicSeed` sourced to
    `suite.json`) and the test checks that every `seed N` a report
    prints is a number the matching source actually uses.
23. **Paid-provider command under an offline heading.** A README run
    line can name `--provider openrouter`; quoting it under "the
    offline run" implies a hosted model was run here. Offline quotes
    keep `--provider mock` only; a paid line is quoted under its own
    lead-in that says it needs a paid provider and was not run.
24. **Aggregate label stronger than the data.** A merged feature pull
    request with `council_reviews = 0` is in the council table but was
    never council-reviewed, so "council-reviewed pull requests"
    overstates it. Counts come from `council-prs.csv` and the prose
    says "merged feature pull requests".
25. **Markdown syntax survives into the PDF.** `**bold**`, a raw
    `[text](url)` link, or a leading `- ` list marker renders as
    literal characters. `mdQuote` converts bold to `\textbf`, links to
    `\href`, and strips list markers; the test strips the same syntax
    from the cached source before it compares a quote.
26. **Code block loses indentation or hides a wrap.** Glue at the
    start of a broken line is discarded, so leading spaces print flat;
    indentation is emitted as `\hspace*`, and a wrapped source line is
    broken with `\\` and its continuation marked `$\hookrightarrow$`
    so one source line never reads as two. The test re-joins marked
    continuations before it compares a line to the source.
27. **Prose printed as code.** A surfaces quote can match a prose
    paragraph (the HTTP API row); prose lines render through
    `mdQuote`, command lines through `mono`, and the quote locator
    still points at the source line.
28. **Quote stops before the block it introduces.** A paragraph that
    ends with a colon and a fenced block quotes only the paragraph.
    `gradingQuote` collects the fence that follows and emits it as a
    second, code-mode quote.
29. **`paper-publish` absent.** The test resolves `PAPER_PUBLISH`,
    then `$PATH`, then the owner path; if none is executable it prints
    the expected path and exits 2 instead of throwing a traceback.
30. **Generator line over 200 characters.** Compressed templates are
    unreviewable; shared text lives in `scripts/pkg-reports/` data
    files and no generator line may exceed 200 characters.
31. **A number written into prose.** Counts and versions that appear
    in sentences come from a data file or a generated macro with a
    `% source:` comment, never a literal.
32. **Committed generated output counts against the size cap.** The
    pr-standards checker counts `reports/*/report.tex` and
    `meta.json`; the generator PR ships no committed output and the
    rendered reports ride in a follow-up PR.
