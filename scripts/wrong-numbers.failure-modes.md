# Wrong-numbers fixes: failure modes

Every way this change can go wrong, written before the edits. The
change corrects four reported numbers (review items M2, M3, M9, M10
on issue #212): the abstract and intro must cite the paired attack
median, the replication count must name its artifact split, the
council severity count needs its real denominator, the hidden-seed
documentation count drops the public seed and years, and the claim
table must stop saying the defect classes cover all 22 packages.
`scripts/wrong-numbers.test.sh` is the end-to-end check; each row
below names the guard that catches it.

- A corrected number drifts from its data file: every replacement is
  a generated macro, never a typed numeral. `\expExplRecordReleased`
  and `\expExplRecordCommit` are computed in `macros.mjs` as
  replicated-plus-not-replicated record clauses split by artifact
  kind, with a fail when the two do not sum to
  `\expExplRecordClauses`. `\expAuditSeedExamplesOther` counts the
  `doc_hidden_seed_examples` values that are neither the frozen
  `publicSeed` in `hidden-seeds.json` nor a four-digit year, and
  `\defectClassedPackages` is the package union of `defects.csv`
  emitted by `collect.mjs`. `node scripts/exp/macros.mjs --check`
  fails on stale output, and the e2e re-derives each count from the
  CSVs with awk and diffs it against the macro.
- The unpaired median macro silently reused: after the fix no
  `.tex` file may reference `\expExplAtkMedianOld` or
  `\expExplAtkMedianNew`; the e2e greps for both names and fails if
  one survives. The paired median claim now names its row count
  (`\expExplAtkPairs`) wherever it is made.
- The replication claim still reads as tarballs-only: the abstract
  and the intro now give the total and the split (released tarballs,
  then the pinned intermediate commits). The e2e greps for
  `\expExplRecordReleased` and `\expExplRecordCommit` in both
  abstracts and in `intro.tex` so neither file can keep the flat
  "replicates N of M on the published tarballs" wording.
- The severity claim loses its denominator again: every use of
  `\councilSeverityPrsRead` outside the appendix method paragraph
  must sit next to `\councilPrsReviewed` or read as
  `\councilSeverityFeaturePrs` of the merged feature pull requests.
  The e2e lists every `\councilSeverityPrsRead` use and greps the
  line for a denominator.
- The seed recount rules re-inflate: the recount filter lives in
  `macros.mjs` and in `hidden-audit-plot.mjs`; the two must agree or
  the figure column and the sentence would tell different counts.
  Both read the public seed out of `hidden-seeds.json` and apply the
  same `^(19|20)\d{2}$` year rule, so a new seed value in the CSV
  lands in both places at once. The e2e recomputes the filtered
  total with awk and compares it to `\expAuditSeedExamplesOther`
  and to the sum of the figure's seed-examples column.
- A year-like seed value wrongly filtered: a value such as 20261015
  is eight digits and never matches the year rule; a four-digit
  value that is a real hidden seed would be dropped as a year. The
  frozen list today has no such value, and the e2e prints the kept
  values so a future drift is visible in the run log.
- The claim table still says "all": the e2e greps `closing.tex` for
  "across all" and for `\defectClassedPackages` so the cell cannot
  quietly keep or regain the 22-package claim.
- Prose regressions: every touched sentence gets a humanizer pass;
  the e2e greps the touched files for em dashes, en dashes and the
  banned words (novel, robust, comprehensive, independent) and for
  the "X, not Y" slogan shape.
- Build or reference breakage: both PDFs build twice under a fixed
  `SOURCE_DATE_EPOCH` and must hash identically, with no undefined
  references and no `??` in the extracted text; the changed pages
  render to PNG for a visual check. `scripts/dmlr.test.sh` runs
  last on the committed tree.
- A hard-typed numeral sneaks into a touched file: the e2e strips
  `\texttt` literals, macro calls and format specs from the edited
  sections and fails on any remaining digit, matching the appendix
  check in `app-experiments.test.sh`.
