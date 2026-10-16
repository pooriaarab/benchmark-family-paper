# Paper data files

- `suite.txt` lists one npm package per line. `scripts/collect.mjs` runs
  each package's published CLI.
- `suite.json` is the collector's raw output: index entries, provenance,
  and mock runs at seeds 1 and 2. `collectedAt` is the only volatile
  field.
- `defects.csv` holds the defect classes in the probing-review
  section, one row per class. `class` is a hyphenated id, `packages`
  lists the affected package ids without the `benchmark-` prefix
  (semicolon-separated), `at_least` is the sourced minimum count, and
  `source` names the record kind. `locators` aligns with `packages`: the
  i-th semicolon-separated locator set sources the i-th package, with
  multiple references joined by ` + `. A locator is `<repo>#<n>` for an
  issue or pull request in `pooriaarab/<repo>`, or
  `<repo>:CHANGELOG.md#L<n>` for a changelog line on `main` (checked
  2026-10-16). The collector renders the classes in
  `generated/defects.tex` and the locators in
  `generated/defect-locators.tex`; never type these numbers into `.tex`.
- `review-rounds.csv` counts fix rounds per package (one round can fix
  several defects, so it is a proxy). The counts repeat from release
  [`review-log-v1`](https://github.com/pooriaarab/benchmark-family-paper/releases/tag/review-log-v1):
  download `review-log.tar.gz` (checksum in `review-log.sha256`), unpack
  it, and run `ls fix-briefs | sed -E 's/-fix[0-9]*\.md//' | sort | uniq -c`
  inside the archive. The release ships the re-review protocol the
  appendix condenses; the first-round protocol is not released.
- `builders.csv` counts `Assisted-by` trailers over all PRs in the 22
  repos (merged feature, merged chore - title starts with "Add CITATION",
  "Add the Zenodo DOI" or "Publish to ants.land" - closed, open).
  `reviewers.csv` counts PR reviews per account. `scripts/builders.mjs`
  rebuilds both from the GitHub record (2026-10-16); the `claude` row is
  the council account.
- `review-notes.csv` carries the small sourced numbers the prose quotes
  that do not come from the collector: `key,value,locator`, expanded
  into `\note<Key>` macros in `generated/review-data.tex`.
- `council.csv` holds the council-review counts behind the approval-style
  review paragraph, rebuilt read-only by `scripts/council.mjs` from the
  GitHub API on 2026-10-16. Method: all pull requests in the 22 repos via
  GraphQL (`author`, `state`, `body` of every review); a merged feature
  pull request is a merged request whose title does not start with a
  chore prefix (same rule as `scripts/builders.mjs`); the council account
  is `claude`. "Merged while the check showed failure" means at least one
  completed `vibecodereview` check-run on the merge head commit concluded
  `failure` (the last-run count is in `merged_council_check_last_failure`
  for comparison). Check runs are read with `filter=all`: the default
  `filter=latest` hides a failed run once a re-run exists, which is how
  the failed `vibecodereview` run on benchmark-honesty#16 was missed in
  an earlier count. "Test job" is the CI `check` job, which runs
  `npm run ci:local`; `merged_test_job_failure` counts merge heads whose
  latest `check` run failed, and `merged_test_job_earlier_failure`
  counts requests where a `check` run failed on an earlier commit.
  `council-prs.csv` is the per-PR detail.
  `reviews_flagging_severity` and `prs_with_severity` are regex
  estimates: a review counts as raising a severity item when a bold span
  in its body names Critical or Major and marks it open, not fixed,
  remaining, found, or new; negations ("No Critical or Major findings")
  are excluded, and items the chair labelled "Fixed" inside the same
  review do not count. `council-reviews.csv` carries every review with
  its regex flag and `council-sample.csv` a deterministic stride sample
  of 50 (every k-th review in the sorted list) with a hand-checked
  `manual` column: all 50 matched the regex,
  so the estimate is reported as "about". `council-read.csv` is the hand
  check: every unflagged review body was read, and it records the 13
  reviews the regex missed. A false positive can only be found among
  flagged reviews, and those were not all re-read, so the 1 it records
  is a lower bound; `reviews_flagging_severity_read` and
  `prs_with_severity_read` apply the corrections (about 174 reviews on
  about 104 pull requests).
- `approval-defects.csv` lists the documented cases of a council
  approval standing behind a defect a later review found: one row per
  case with the pull request, the approved commit and time, the defect,
  who found it, the fix commit, and the merged head. `collect.mjs`
  counts the rows into `\approvalDefectCases`.
- `trivial.csv` is the preregistered study's first result: per first-wave
  package, the best trivial-policy mean at 0.1.0 (`old`) and 0.2.0
  (`new`) and the winning policy. The registered plan and the deviation
  log live on Zenodo (DOIs in Section "A preregistered check");
  `scripts/collect.mjs` regenerates Table trivial from the CSV and
  recomputes the one-sided exact sign test.
