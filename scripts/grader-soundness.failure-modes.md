# Failure modes: grader soundness section (C6)

Written before the edits. Every way the new Section 6 and its macros
can fail, and the check that catches it.
`scripts/grader-soundness.test.sh` is the end-to-end check.

## A claim without a data file behind it

- The section reports E4 contract probes, the E5 tarball audit and
  hidden-split overlap, and the E6 determinism run. Every counted
  quantity must come from a generated macro in
  `paper/generated/exp-macros.tex`, which `scripts/exp/macros.mjs`
  writes from the committed CSVs under `paper/data/exp/` and the
  frozen JSON lists under `scripts/exp/`. A number typed into the
  section prose is a claim with no source.
- Check: the test strips comments, `\texttt{...}` names and version
  literals (`0.1.0`, `0.2.0`; pinned artifact identifiers, not
  measurements) from the new section, then fails if any numeral
  remains. `node scripts/exp/macros.mjs --check` fails when a `\exp*`
  macro is used in any paper file but not generated.

## A macro that misreads the data

- The new determinism macros could count artifacts instead of
  packages, read `uniform` off the wrong arm, or let a failed run
  (status not `ok`) masquerade as uniform output. The probe splits
  could class a fail by its reason text instead of the frozen probe
  type, or count outside-contract cells as pass or fail.
- Mitigation: `macros.mjs` fails when a determinism row names an
  unpinned or unreleased artifact, when a package lacks its full
  frozen grid of mock runs or its trivial-server repeats, when a fail
  row's probe id carries no frozen TYPE A or TYPE B mark in
  `probes.json`, or when the outside-contract flag disagrees with the
  result. A package counts byte-identical only when every mock row
  says `uniform=yes`, matching the definition in
  `paper/data/exp/README.md`.

## Text naming an experiment that is not in the data

- The section may only report the three checks the CSVs carry:
  `contract-probes.csv` (E4), `tarball-audit.csv`, `hidden-census.csv`
  and `hidden-overlap.csv` (E5), `determinism.csv` (E6). No real-model
  cell exists, so the section must not claim one.
- Check: read the diff; every stated result traces to a macro whose
  source CSV is listed in the generated header comment.

## Over-claiming what a probe pass means

- A passing cell means the frozen expected rule held at the pinned
  version on that probe, nothing more. The section must not say the
  graders are correct, and must report the defects the probes found
  as found at pinned versions, not fixed. Wave-2 rows describe each
  package's only release, with no before/after reading.
- Check: read the diff against `~/fam/paper-v2-plan.md` section 3
  "Cannot support"; the closing paragraph states the limits.

## Figure placeholders left behind or orphaned

- `main.tex` and `main-dmlr.tex` carry `Placeholder placement` comment
  lines for F7 and F8 that this section owns. Leaving them, dropping
  the `\input`, or losing `\label{fig:probes}` or
  `\label{fig:hiddenaudit}` breaks the build or the reference.
- Check: the test greps that the placeholder comments are gone from
  both mains, that both mains still input the figure files, and that
  both labels still exist in `paper/figures/`.

## Undefined reference, citation, or layout overflow

- New `\ref` targets (`fig:probes`, `fig:hiddenaudit`, `sec:review`,
  `sec:prereg`) must resolve; the two wide heatmaps can overflow.
- Check: build logs are grepped for `undefined`, `citation` and
  `overfull`; extracted PDF text is grepped for `??`.

## Banned prose patterns

- Em dash, "X, not Y" slogans, and the words `independent`, `novel`,
  `robust`, `comprehensive` are banned; `first` cannot appear as a
  claim. Determinism wording must not call the suite reproducible
  wholesale: the byte-identical count covers the mock and
  trivial-server paths only.
- Check: the test greps the section for an em dash, the slogan shape,
  and the banned words.

## Page budget

- The plan gives Section 6 about 1.5 pages inside a 9.5 page main
  text. The test reports the section's page span in the NeurIPS build
  and the total page count so the reviewer sees the real numbers.

## Non-repeatable artifact

- The build must reproduce. The test exports a fixed
  `SOURCE_DATE_EPOCH`, builds both PDFs twice, and diffs the two
  sha256 prints.

## Verification command

```bash
bash scripts/grader-soundness.test.sh
```
