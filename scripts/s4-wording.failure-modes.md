# Section 4 wording fixes: failure modes

Every way this change can go wrong, written before the edits. The
change rewrites the re-measurement paragraph of
`paper/sections/adversarial.tex`, regenerates `exp-macros.tex` and
`exploit-verdicts.tex` (T3) from `scripts/exp/macros.mjs`, swaps the
F4 "no E2 row" mark for "no attack row" in
`scripts/exp/policy-ladder.mjs`, replaces hard-typed numbers in
`paper/sections/app-defect-classes.tex` with generated macros, moves
the builder-agent naming out of the Section 4 lead, and replaces the
E-labels with plain names. `scripts/s4-wording.test.sh` is the
end-to-end check; each row below names the guard that catches it.

- A count typed into a `.tex` file: every number in the touched text
  comes from a generated macro. `node scripts/exp/macros.mjs
  --check` regenerates both outputs and fails on stale content or on
  an `\exp*` name used but not generated, and the e2e greps the
  edited files for the old hard-typed forms (`0.250`, `52 percent`,
  `EVALUATOR_POOL_SIZE`, `a mean of 1`, `ten more READMEs`, `two
  ticket tasks`, `0.35`) so the literal cannot silently return.
- The tarball-versus-checkout split misstated: the row counts by
  artifact kind are computed in `macros.mjs` from the three result
  CSVs (`\expExplReleasedRows` counts the distinct frozen lines parts
  a and b ran plus the two part-c rows at a released tarball state,
  `\expExplCommitRows` the lines on intermediate commits, and
  `\expExplReplReleased` / `\expExplReplCommit` /
  `\expExplNotReplReleased` / `\expExplNotReplCommit` split the
  verdicts the same way); the split is cross-checked against the run
  row total so a row can never fall out of the count, and the e2e
  greps `adversarial.tex` for the old claims ("shipped tarballs",
  "published artifacts", "shipped artifacts") so the over-broad
  wording cannot come back.
- Pelican r9 read as exploit credit: the fix-fails rows split by
  `isAttackRow` into attack (`\expExplFixFailsAttack`,
  `\expExplFixFailsAttackPkgs`) and honest re-check
  (`\expExplFixFailsHonest`, `\expExplFixFailsHonestPkgs`) macros,
  T3's lower block gains a `vs` column naming what the relation
  compares against, so r9's `oracle` target is visible next to its
  measured 0, and honest rows print `fix fails (honest)` in the
  verdict cell. The e2e greps the generated table for the
  `fix fails (honest)` row and its `oracle` target, and greps
  `adversarial.tex` for the old "still gives the exploit credit"
  phrasing.
- The unpaired medians presented as one set: `macros.mjs` pairs the
  wave-1 attack rows by frozen line and emits
  `\expExplAtkMedianOldPaired`, `\expExplAtkMedianNewPaired`,
  `\expExplAtkPairs` and `\expExplAtkNewOnly`; the text uses the
  paired values only and names the one new-only row. If a row ever
  loses one arm the paired set shrinks and the macro counts change
  with it, which `--check` surfaces.
- An undefined term used first: E-labels (E1, E2, E3, E4) are
  replaced by plain names in every main-text file and caption; the
  e2e greps `sections/` and `figures/` for `\bE[1-6]\b` outside the
  appendix placeholder. "Frozen row" and "clause" are defined in
  the re-measurement paragraph's method sentence at first use.
- The F4 mark naming the wrong absence: the packages with no attack
  row carry a `no attack row` node (honesty and schema-mutation do
  have E2 rows; they lack an attack row). The mark text lives in
  `policy-ladder.mjs`; `policy-ladder.test.sh` counts the nodes,
  and the e2e greps the generated stems for `no E2 row` so the old
  wording cannot return.
- A generated file left stale: the e2e regenerates the dumbbell,
  ladder and macro outputs and requires the `--check` modes clean,
  then builds both PDFs twice under a fixed `SOURCE_DATE_EPOCH` and
  diffs the two sha256 sets. `scripts/dmlr.test.sh` rebuilds the
  DMLR submission from a clean HEAD checkout, so nothing works only
  in the dirty tree.
- Prose regressions: the e2e greps the touched files for em/en
  dashes and the banned words (independent, novel, robust,
  comprehensive), and renders the re-measurement and ladder pages
  of both PDFs for visual review.
