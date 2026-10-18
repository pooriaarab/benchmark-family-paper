# Length pass (review M5 and M6): failure modes

Every way this change can go wrong, written before the edits (issue
#221). `scripts/length.test.sh` is the end-to-end check.

- A moved float loses its label or its label loses its reference:
  every moved `fig:*`/`tab:*` label must still appear exactly once
  in the tree and every `\ref` to it must still resolve (no `??` in
  either PDF).
- Evidence silently deleted with the moved text: the e2e requires
  every sentence the main text drops to live in an appendix file
  (grep for the moved fragments: the field list, the verbatim
  block, the clause bookkeeping, the disclaimer count, the licence
  sentences, the registered-design detail).
- The disclaimer count creeps back: the phrase "configured" plus
  "agent sessions"/"sessions" in the author-configured sense may
  appear at most once in `verification-layers.tex` and once in
  `closing.tex` outside the disclosure appendix (App F keeps its
  own count; the e2e greps the main-text files).
- Table 3 keeps its clause-level block in the main text: the e2e
  requires `exploit-verdicts-low.tex` to exist under
  `paper/generated/`, hold `tab:exploit-verdicts-low`, and be
  `\input` only inside `sections/app-results.tex`.
- The probe heatmap keeps non-released rows: the e2e checks
  `generated/probe-heatmap-rows.csv` holds exactly the 22 released
  artifacts (12 wave-1 at 0.2.0, 10 wave-2 at 0.1.0) and the row
  count macro matches.
- A pointer to a moved float reads as if it were still inline: the
  e2e requires "in the appendix" or an appendix pointer next to
  each moved `fig:`/lower-table reference in the main sections.
- Stale process detail stays in the main text: the e2e forbids
  `\texttt{check} job`, `performance.now`, the eight `trivial-*`
  names, `eval-matrix`, `eval-analyze`, `versions.json`, and the
  pull-request locators in the main-text section files.
- Regeneration silently undoes the change: `macros.mjs` is the
  source of the verdicts split, so `--check` runs and the script
  verifies the two generated verdicts files are fresh;
  `collect.mjs` must produce no diff.
- Style regressions on touched files: em/en dash, banned words,
  "X, not Y" slogans, "rubber stamp", "diff-reading approvals".
- Build or reference breakage: both PDFs build twice under a fixed
  epoch with identical sha256, no `??`, no overfull box, no
  "Float too large"; the moved-figure appendix pages render.
  `scripts/dmlr.test.sh` runs last.
