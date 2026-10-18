# Appendix J fill: failure modes

Every way this change can go wrong, written before the edits. The
change replaces the placeholder in `paper/sections/app-experiments.tex`
with the real experiment specifications: the frozen lists (the
trivial-battery reason classes, the contract-probe list, the exploit
list with its version pins and the three result files), a table of
what each run is and what it cannot show, the frozen rows no run
reached, the runs that were never done, and a pointer to the
deviation log. `scripts/app-experiments.test.sh` is the end-to-end
check; each row below names the guard that catches it.

- A number typed into the new text: every count and runtime in the
  appendix comes from a generated macro. `node scripts/exp/macros.mjs
  --check` fails when `exp-macros.tex` is stale or when the appendix
  uses an `\exp*` name that is not generated, and the e2e greps the
  file for digits outside `\texttt` file names and macro calls so a
  bare numeral cannot slip through.
- A number that no longer matches its data: the new macros are
  computed in `macros.mjs` from the same CSVs and frozen JSON the
  prose cites (`reason-classes.json`, `probes.json`,
  `versions.json`, `exploits.csv`, `runtimes.csv`), so a stale or
  invented count fails `--check` against the regenerated file.
  `runtimes.csv` gains one measured row per experiment script that
  lacked one; each row was timed on this machine on 2026-10-18 and
  the runtimes read as order-of-cost, matching the file's own note.
- The "rows not run" list drifting from the frozen list: the seven
  needs-reviewer-policy rows print as a generated table,
  `paper/generated/exploit-policy-only.tex`, emitted by
  `macros.mjs` straight out of `exploits.csv` and freshness-checked
  by `--check`. A frozen row edited out of that class would change
  the generated table, so the appendix cannot disagree with the
  list.
- An appendix label with no reference, or a dangling one: the
  section keeps `\label{app:experiments}` (the label already exists
  and is the appendix's own anchor), the new text cross-references
  `app:deviations`, `app:reproducibility`, `sec:prereg`,
  `sec:soundness` and `sec:review`, and the e2e fails on `??` in
  either extracted PDF and on `undefined` in either build log.
- A runtime column that reads as a promise: the table labels the
  column "about" seconds or minutes and the caption says the numbers
  are single-machine order-of-cost timings, matching the
  `runtimes.csv` README note.
- Internal experiment labels leaking into the paper: the paper's own
  style bans the E-names in sections. The e2e greps the appendix for
  the banned pattern so the plain names (trivial battery, contract
  probes, exploit re-measurement, hidden-split audit, determinism
  run) are what the reader sees.
- An unrun experiment presented as run: the two empty rows (the
  prompt-reading tier and the free-model run) print no runtime and
  no data file, only the reason nothing exists, and the e2e greps
  for the wording so a later edit cannot quietly give them a count.
- The appendix drifting from the two builds: the file is shared by
  `main.tex` and `main-dmlr.tex`, and the e2e builds both PDFs twice
  under a fixed epoch and diffs the sha256 pair, then renders the
  appendix pages of both PDFs for review.
