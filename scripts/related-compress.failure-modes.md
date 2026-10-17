# Failure modes: compress related work (C9)

Written before the edits. Every way the compression can fail, and the
check that catches it.

## Dropped citations leave undefined references

- The MCP and pelican paragraphs carry cite keys
  (`mcp2025spec`, `willison2024pelican`). Removing the paragraphs is
  safe: a key unused in the text stays in `refs.bib` harmlessly, while
  a `\cite` whose key vanished would print `??`. No `\label` lives in
  related.tex, so nothing can be orphaned.
- The compressed threat-model sentence must keep
  `wallace2024instruction`, `zhang2025iheval`,
  `debenedetti2024agentdojo`, `in2026permembench` and
  `w3c2024wcag22` cited or those keys go uncited; uncited is legal but
  drops the attribution the wave-2 packages rely on.
- Check: `scripts/related-compress.test.sh` builds both PDFs and greps
  the logs for `undefined` and `citation`, and greps the extracted
  text for `??`.

## A counted number typed by hand

- The compression must not introduce a counted number. The only
  digits kept are inside citations already on main (Bean and
  colleagues' 445, 53.4 and 16.0) or generated macros
  (`\suiteSaturation` is removed with the index-entry sentences).
- Check: `git diff` on related.tex introduces no bare numeral that is
  not a citation detail already present on main.

## Claim drift during compression

- Kept sentences are tightened, not re-argued: benchmark quality
  (contamination, saturation), reward hacking, and the checklist
  literature stay; no claim is added and none of the kept claims
  changes direction.
- Check: read the full `git diff` of `related.tex`; every kept
  sentence maps to a sentence on main.

## Page target missed

- The plan gives Section 7 about 0.6 page. The check measures the
  section's span in the built PDF and prints it; the reviewer can see
  the real number rather than a guess.

## Verification command

```bash
make related-test
```
