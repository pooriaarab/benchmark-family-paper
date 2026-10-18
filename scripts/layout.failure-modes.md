# Layout pass (review M7 and M11): failure modes

Every way this change can go wrong, written before the edits (issue
#223). `scripts/layout.test.sh` is the end-to-end check.

- The scatter figure keeps its empty headroom: the e2e requires the
  axis ranges in `fig-trivial-scatter.tex` to be the reduced ones
  (ymax below 0.1, xmin below 0) and `axis equal image` to be gone so
  the shallow data band fills the frame.
- Wave-2 rug labels still cross the axis: the e2e requires the rug
  lane and its labels to sit between ymin and 0 with `clip=false`
  kept, and it renders the figure page of both PDFs for inspection.
- "payment-delegation" clipped again: xmax must leave room for the
  rotated label; the e2e checks `xmax` reaches at least 0.55.
- "9 at origin" colliding again: the rendered page is checked and the
  notes plot keeps its own `nodes near coords` style.
- Hidden-audit counts off their rows: the e2e requires
  `anchor=center` on the count nodes in `fig-hidden-audit.tex`, a
  `yshift` on the right-panel x tick labels so zero markers cannot
  cover them, and the legend attached with `xticklabel* cs` instead
  of a fixed negative offset.
- Grayscale pass/fail confusion: the e2e requires the generated
  hatch file to contain a fail-cell overlay and the legend's fail
  swatch in `fig-probe-heatmap.tex` to carry the same pattern.
- Regeneration silently drops the new hatch: `probe-heatmap.mjs`
  must emit it, so `--check`-style freshness runs and the script
  diffs the generated outputs before and after.
- Fig 2 wave rule unexplained: the caption must name the dashed
  rule's wave meaning.
- DMLR still claims "Reviewed on OpenReview": the e2e greps the
  built `main-dmlr.pdf` text and fails if the phrase appears.
- Citations without parentheses: the DMLR text must contain a
  parenthesised citation (`(Reuel` or similar) and no bare
  `Name et al. (year)` preceded by text where `\cite` rendered as
  `\citet` — checked by grepping for `(Reuel et al.` in the PDF.
- Floats still drifting or oversized: the build log must contain no
  "Float too large" and no overfull \hbox/\vbox in either build, and
  `\FloatBarrier` must appear in `main-dmlr.tex` between the
  appendix inputs.
- Label or reference breakage: no `??` in either PDF; both PDFs
  build twice under a fixed epoch with identical sha256; the claim
  table keeps `tab:claimgap` and the exploits figure keeps
  `fig:exploits`.
- Style regressions on touched files: em/en dash, banned words and
  ", not " slogans are forbidden on every file this pass edits.
- `scripts/dmlr.test.sh` runs last (clean-checkout DMLR build).
