# Failure modes: scripts/pkg-reports.mjs

Written before the generator: every way it can fail, and the response.

## Inputs and data
1. **Unknown package.** Not `all` or a `zenodo-dois.json` key: fail
   naming the argument.
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
   with `_ref` and `_fetchedAt` stamps; `--refresh` refetches; the
   cache date is printed every run. `GITHUB_TOKEN`/`GH_TOKEN`
   authenticate.
6. **Rate limit / network down.** A non-200 fetch fails naming URL
   and status. The git-trees listing is fetched on every run, so the
   generator needs the network even when the file cache is warm.
7. **README without a question line.** The first lead paragraph that
   says what the package measures or asks is quoted; if none qualifies
   or carries banned wording, fail. Never paraphrase.
8. **Grading doc absent.** Quote `docs/grading.md`'s first paragraph.
   When no `docs/grading.md` exists the report says so in one prose
   sentence; it never quotes whichever `docs/*.md` file sorts
   first, and a present grading doc with no usable paragraph still
   fails.
9. **Claim with no source.** Every printed number is a `\pkg*` macro
   with a `% source:` comment; every package sentence is a verbatim
   quote block with a `% quote:` locator. The test checks both.
10. **Banned wording.** Authored prose must not contain "independent",
    "novel", "first", "robust", "comprehensive", an em dash, or an
    "X, not Y" slogan. The test greps outside quotes for the banned
    words, an em dash, `, not ` and `not of `.

## Outputs

11. **PDF overflow.** Long verbatim lines get invisible `\allowbreak`
    breakpoints the test strips before comparing, and the test fails a
    printed code row that unescapes past the quote measure.
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
21. **Floats drift out of their section.** Tables use `[H]` (`float`)
    with captions above the tabular.
22. **Seed attributed to the wrong run.** The public task split has a
    generator seed; `collect.mjs` runs the mock at its own seeds. A
    sentence that names one for the other misstates the record, so the
    report keeps separate macros (`\pkgMockSeedA`, `\pkgMockSeedB`
    sourced to `scripts/collect.mjs`, `\pkgPublicSeed` sourced to
    `suite.json`). The test joins each paragraph before it checks, so
    a line break cannot hide a seed, and it binds the role word to
    the segment that holds the seed: a public-split seed needs a
    split or generation role, not just the word "public", and a mock
    seed needs "mock". A package with no public seed prints a stated
    absence, never a "seed none" placeholder.
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
    unreviewable; repeated text is a named constant and no generator
    line may exceed 200 characters.
31. **A number written into prose.** Counts and versions that appear
    in sentences come from a data file or a generated macro with a
    `% source:` comment, never a literal.
32. **Committed generated output counts against the size cap.** The
    pr-standards checker counts `reports/*/report.tex` and
    `meta.json`; the generator PR ships no committed output and the
    rendered reports ride in a follow-up PR.
33. **Limits fallback that never runs.** `sectionLine` used to `fail()`
    inside a `try`, so the `catch` fallback was dead code and a README
    without a `## Limits` heading stopped the run. The rule now: quote
    the first README section whose heading matches limits, scope, what
    it does not or caveats; when no such section exists the report
    prints a stated-absence sentence in place of the quote. The run
    stops for nothing in this lookup.
34. **Source links drift as `main` moves.** Fetches and `blob/` links
    used `main`, so a quote's permalink changed meaning on the next
    README commit. Sources are read from the `v<version>` tag that
    `paper/data/suite.json` records for the package and every link
    points at `blob/v<version>/`. A missing tag fails the fetch with
    the URL and status. The cache records the ref it fetched in a
    `_ref` stamp and is discarded when the stamp is absent or holds
    another ref; an unstamped cache can carry shifted locators.
35. **Tree listing fails silently.** A non-200 from the git-trees API
    used to skip the docs fetch without a word, leaving stale or
    absent docs. It now fails naming the URL and status, the same as a
    raw-file fetch.
36. **Code lines measured in escaped characters.** `wrapCode` compared
    the escaped string length against 95 glyphs while the typewriter
    measure fits about 70, so lines of 71 to 95 glyphs ran past the
    margin. Width is now counted in rendered glyphs (each `\cmd{}`
    escape is one glyph, `\hspace*{Nem}` is N/0.5, `-{}-` is two). The
    quote measure fits about 62 typewriter glyphs, so rows wrap at 60
    and the `$\hookrightarrow$` continuation prefix counts toward the
    width. The test fails when a printed code row unescapes past 62
    glyphs.
37. **Markdown link target dies in the PDF.** `[text](data/x.md)`
    used to emit `\href{data/x.md}`, a target no viewer can open.
    Relative targets resolve against the quoted file's tagged blob
    URL. The test fails on any `\href` or `\url` address that is not
    absolute or that carries whitespace or a `\` escape such as
    `\allowbreak`; a break inside the address leaks `\protect
    \penalty` into the PDF `/URI` and the link 404s.
38. **Header names a file outside the PR.** A comment pointing at a
    file that only exists in a later PR dangles for a reader of this
    PR alone. Headers name only what this tree ships.
39. **Surface quote ends on a colon.** A README surface line ending in
    `:` announces a fenced block; quoting the sentence alone leaves
    the reader on a colon. The quote now collects the fence it
    introduces and prints it as a code quote, the same rule
    `gradingQuote` already follows.
40. **Seed check trusts a macro name.** `\pkgPublicSeed{}` contains the
    word "public", so a clause that gave the public-split seed a mock
    role still passed the role test. The test strips `\pkg<Name>{}`
    tokens before it matches role words, in the body and in the
    `meta.json` abstract.
41. **Provenance under another heading.** Packages name the section
    differently (`Data and reproducibility`, `Reproduce the data`,
    `Where the data comes from`, a `Reproducible task generation`
    subsection), so the lookup matches any `##` or `###` heading about
    data, provenance or reproduction and takes its first text line.
    A README with none of these gets a stated-absence sentence, the
    same rule as the limits quote.
42. **Mock-run command carries flags.** Packages write the offline run
    as `run --model offline --provider mock` or with a trailing
    `--json`, so a literal `run --provider mock` match misses it. The
    run line matches `npx <pkg> run` followed anywhere on the line by
    `--provider mock`; the sample block is still the next fence, and
    a `--provider openrouter` fence stays a paid quote.
43. **Comparability sentence wraps or shares its line.** Changelog
    entries break mid-phrase (`not\ncomparable`) and a clean
    comparability sentence can sit on the same line as a banned word
    (`an independent deep review`). The lookup joins each changelog
    paragraph, then quotes only the sentence that carries the phrase,
    and only when that sentence carries no banned wording. A package
    whose changelog records no such sentence (a 0.1.0 entry has no
    earlier release to compare against) gets a stated-absence
    sentence, the same rule as limits and grading.
44. **HTTP surface named without `Routes are`.** Some READMEs write
    `` `handler` from `<pkg>/api` `` and a `Routes:` list instead of
    the `Import handler ... Routes are` sentence. The surface row
    matches a backticked `handler` mention or a `Routes:` list line,
    which keeps the same first match on the READMEs that already
    worked.
45. **A quote carries the em dash its source wrote.** Source text can
    hold a `—`; `tex()` escapes it to `\textemdash{}` and the gate's
    wording checks skip quote regions anyway. Source-line selection
    bans the five English words only; the em-dash ban binds authored
    prose. A README whose only question line uses an em dash is still
    quoted verbatim.
46. **A banned word inside a hyphenated compound.** `cancel-first`
    trips a `\bfirst\b` ban because `-` is a word boundary, and the
    memory-conflict question line has no other candidate. The ban
    reads whole words only: a banned word may not touch a letter,
    digit or hyphen on either side, so `cancel-first` passes while a
    bare `first` still fails. The gate's banned-word check uses the
    same hyphen-aware boundary.
47. **The prose wrapper splits a link address.** `wrapProse` treated
    `\href{URL}{text}` as plain text and put `\allowbreak` plus a
    newline inside the URL argument, so the PDF `/URI` carried TeX
    internals and the link 404d. `\href{URL}{` and `\url{URL}` are
    now single atoms: the address is never split, and a break cannot
    land between `}` and `{`, where it would be read as the link
    text.
48. **`make reports` with no `PKG` builds the wrong report.** A
    `PKG ?= benchmark-pelican` default silently generated pelican.
    The target now requires `PKG=<package|all>` and exits 2 without
    it.
49. **Committed reports drift from the generator.** The gate
    regenerated into a temp dir and never compared with the committed
    `reports/<pkg>/` files, so a later generator change could leave
    stale output in the tree. When the checkout holds a committed
    `report.tex` or `meta.json` for the package, the test compares
    it byte for byte with the regenerated file.
50. **A link rots after the report ships.** A `blob/` URL that
    resolved on generation day can 404 later; with `--links` the
    gate curls every `\href` and `\url` target in the generated
    reports and fails on a non-200. The e2e run passes `--links`
    only when the network is present.
51. **Index-entry grader summary trips the wording rule.** The
    `suite.json` grader line prints as authored prose, so a banned
    word inside it fails the gate (ranking-stability: "the first
    number token"). A summary that matches `BANNED` is dropped: the
    report says so and names the data file in place of the quote,
    and the sentence is never rewritten to hide the rule.
52. **A count of one prints a plural noun.** The abstract and the
    council-record sentence fixed their nouns, so a singular count
    read "1 defect classes", "1 were approved" or "1 requests"
    (exploit-resistance, latency-budget, pelican). The noun now
    comes from the count at generation time, and the committed
    report the fix changes is regenerated in the same change.
53. **A grader summary trips the slogan rule instead.** The same
    sentence fails the `, not ` slogan check when the summary itself
    carries that shape (rollback-recovery: "tool call, not free
    text"). The drop applies to either wording rule.
54. **A wrapped README paragraph prints a mid-sentence fragment.**
    `pickLine` and `sectionLine` returned one physical line, so a
    README that wraps its question, provenance or limits paragraph
    at 80 columns was quoted only to the first line break
    (accessibility-fix printed "measures whether a model can repair
    a broken" and stopped). `joinPara` now joins the continuation
    lines until a blank line, a heading, a fence, a table row, a
    blockquote or a new list item; a one-line paragraph keeps its
    old output, so the gate's byte-compare on the committed reports
    still holds.
