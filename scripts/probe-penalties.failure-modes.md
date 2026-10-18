# Probe-penalty split and term definitions: failure modes

Every way this change can go wrong, written before the edits. The
change does two things (issue #213, review M4 and M8): it splits the
designed duplicate-call penalties out of the probe fail counts and it
defines or replaces the terms the review flagged (wave, type-A/B,
clause, council, part-c, r<n>, index-entry, fix brief, the loose
bound). `scripts/probe-penalties.test.sh` is the end-to-end check; each
row below names the guard that catches it.

- The split counts drift from the probe data: every new count is a
  generated macro. `macros.mjs` counts released-version type-B fails by
  probe id: `\expProbesDupCallCells` on `atk-dup-tool-calls`,
  `\expProbesWrapCells` on `atk-prompt-echo` plus `atk-score-injection`,
  and a fail check requires the two plus any other type-B fail to sum
  to `\expProbesMovedFailCells`. The e2e re-derives both counts with
  awk over contract-probes.csv and versions.json and diffs them
  against the macros.
- The "22 of 22" honest-acceptance overclaim returns: the prose may
  not pair `\expProbesHonestAccepted` with `\expPackages`. The e2e
  greps grader-soundness.tex for `\expProbesHonestAccepted` and fails
  if it survives, and requires `\expProbesHonestUnpromised` (the 13
  released graders that promise no normalisation) to appear instead.
- The figure quietly keeps counting the penalties as defects:
  probe-heatmap.mjs emits a separate state for `atk-dup-tool-calls`
  fail cells and splits the margin-bar counts into real fails and
  expected penalties. The e2e recomputes both columns from
  contract-probes.csv, requires the caption and legend to name the
  expected penalties, and requires the bar file to carry the extra
  column.
- A term is still used before its definition: the e2e greps the
  section files in reading order and fails if `wave-1` or `wave-2`
  appears before the wave definition sentence, if `type-A` or
  `type-B` appears before the sentence that spells out both rules,
  if `part-c` survives outside the data README, or if `index-entry`
  in the suite-table caption lacks its appositive. It also requires
  the council definition in verification-layers.tex, the clause
  method sentence ahead of the first clause count in
  adversarial.tex, and the r<n> gloss next to the miss list.
- The garbled sentence regresses: the e2e greps adversarial.tex for
  the literal `where checkout-consent` tail that collided with the
  generated package list and requires the parenthesised detail
  form.
- Prose regressions: humanizer pass on every touched sentence; the
  e2e greps the touched files for em/en dashes and the banned words
  (novel, robust, comprehensive, independent) and for the "X, not Y"
  slogan shape.
- A hard-typed numeral sneaks into a touched file: the e2e strips
  \texttt literals, macro calls, format specs, versions, wave and
  hypothesis labels, licence names and axis code from the touched
  sections and fails on a remaining digit.
- Build or reference breakage: both PDFs build twice under a fixed
  `SOURCE_DATE_EPOCH` and must hash identically, with no undefined
  references and no `??` in the extracted text; the changed pages
  render to PNG for a visual check. `scripts/dmlr.test.sh` runs last
  on the committed tree.
