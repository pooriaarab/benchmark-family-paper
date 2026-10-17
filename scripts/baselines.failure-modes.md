# Failure modes: baseline section rewrite (C5)

Written before the edits. Section 5 (the preregistered check plus the
E1 battery) is rewritten in `paper/sections/prereg.tex`, the
placeholder comments above the table and the F5/F6 figure inputs are
dropped in both mains so the floats sit directly under the section
input (the placement every other float in the paper uses), and
`scripts/exp/macros.mjs` gains the per-cell trivial-score macros the
prose cites. `scripts/baselines.test.sh` is the end-to-end check. Each
row names which guard catches the failure.

## A counted number typed by hand

- Every measured number in the section must come from a generated
  macro (`\trivial*`, `\exp*`, `\review*`). Typed digits that are not
  measurements are still real digits: the Zenodo DOIs and the
  registration date in the footnote, the version tokens `0.1.0` and
  `0.2.0`, and the designators H1-H3, E1-E9, F1-F8, D2-D6, L1-L3,
  T1-T4 and `wave-1`/`wave-2`. A check that fails on any digit would
  fail on those, so the scan strips comments, `\texttt{...}` groups,
  ISO dates, version tokens and the designator patterns first;
  anything left is a typed count and fails.
- The per-cell best-trivial scores the prose cites (checkout-consent,
  tool-errors, ranking-stability at both versions; the three wave-2
  nonzero cells) are emitted by `scripts/exp/macros.mjs` from
  `trivial-headroom.csv`, so a quoted cell can never disagree with
  the data file.
- Check: `scripts/baselines.test.sh` digit scan;
  `node scripts/exp/macros.mjs --check` fails when a `\exp*` name in
  the text is not generated, and `macros.test.sh` proves the
  stale-output guard still fires.

## Undefined reference, citation or control sequence

- The section cites `sec:review`, `app:deviations`, `app:validation`,
  `sec:soundness`, `fig:trivial-scatter`, `fig:trivial-reasons` and
  `tab:trivial`. A label that does not exist prints `??`; a `\exp*`
  macro the generator does not emit is an undefined control sequence.
- Check: the test builds both PDFs, greps the tectonic logs for
  `undefined`, `citation` and `overfull`, and greps the extracted
  text of both PDFs for `??` (filtering the `?? "` nullish operator
  in the engine listing, the same false positive the layers check
  filters).

## Orphaned or double-input float

- The table and the two figures keep their inputs in `main.tex` and
  `main-dmlr.tex`, directly under the `\input{sections/prereg.tex}`
  line; only the placeholder comments above them are removed. A
  dropped input orphans the float; a duplicated input redefines the
  label and throws a LaTeX warning that the log grep may not phrase as
  "undefined".
- Check: the test greps that each of `generated/trivial.tex`,
  `figures/fig-trivial-scatter.tex` and `fig-trivial-reasons.tex` is
  input exactly once in each main, and that `\label{tab:trivial}`,
  `\label{fig:trivial-scatter}` and `\label{fig:trivial-reasons}`
  still exist.

## Text promising an experiment that is not in the data

- The E2 re-measurement and the E3 heuristic tier have no merged
  data, and the ladder figure F4 does not exist. The section must
  leave exactly one placeholder comment for the later PR and must
  not cite a number or a `\ref` for that rung.
- Check: the macro guard (no `\exp*` name exists for an unmeasured
  arm) plus a test grep that the placeholder comment is present and
  that no `\ref{fig:ladder}` or `fig-policy-ladder` input exists in
  the paper sources.

## Wave-2 numbers read as registered

- The wave-2 arm has no 0.2.0 release, so its E1 cells sit outside
  the registration. If the prose reports them on the same footing as
  the 192 registered cells, the claim outruns the design.
- Check: human review against this note; the F5 caption already marks
  the wave-2 lane as outside the registered comparison, and the
  section must say the same in words.

## The null overstated

- Three non-tied packages is a null result on H1, not a proof that
  generic baselines catch nothing: the battery found live nonzero
  blind credit at released versions (payment-delegation,
  rollback-recovery, instruction-hierarchy, ranking-stability). The
  text must report those cells and must not write that blind
  policies earn nothing.
- Check: human review; the digit and macro guards keep the reported
  cells equal to the CSV.

## A figure claim that outruns the data

- F5 shows T at 0.1.0 against 0.2.0 and nothing else; F6 shows reason
  shares for zero rows and nothing else. A caption or sentence that
  reads a detection rate into them outruns the data.
- Check: human review against the captions, which name the data
  files.

## Section length out of budget

- The plan gives Section 5 about 1.5 pages of main text. The test
  reports the section's page span in the NeurIPS build so the
  reviewer sees the real number.

## Non-repeatable artifact

- The paper claims reproducibility, so the check builds both PDFs
  twice under a fixed `SOURCE_DATE_EPOCH` and prints the sha256 of
  each build; the two rounds must print the same hashes.

## Verification command

```bash
make baselines-test
```
