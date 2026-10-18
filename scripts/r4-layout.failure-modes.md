# Failure modes: the r4 layout pass (issue #229)

What can break, and the check that catches it first.

1. The hidden-audit legend slides back onto the tick labels or the
   markers. The e2e requires the anchored `north west` corner legend
   in `fig-hidden-audit.tex` and bans the `xticklabel* cs` anchor.
2. The scatter labels creep back across the y = x line. The e2e
   requires the generated `trivial-scatter-online.csv` series with the
   right-shifted label style, and `trivial-scatter.mjs` must split the
   near-line rows itself so a new cluster point lands in the shifted
   series automatically.
3. Table 11 regrows past the DMLR page. The e2e requires
   `\begin{longtable}` for `tab:experiments` and bans a floating
   `table` environment around it; both builds run twice and fail on
   any `Float too large` or overfull box.
4. A reference or caption disappears with the moves. The builds fail
   on `undefined` and the extracted text is grepped for `??`; the
   e2e also requires the `tab:experiments` label inside the longtable
   caption.
5. Grayscale legibility regresses. The e2e greps the two figure
   sources for non-monochrome fills: each series must keep a distinct
   marker or shade that survives grayscale (checked for the marker
   styles and the black!xx/okblue/okverm palette already used).
6. The build regresses silently: both PDFs build twice under a fixed
   epoch with identical sha256, and `dmlr.test.sh` re-verifies the
   clean-checkout DMLR build.
