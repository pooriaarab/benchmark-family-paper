# E5 failure modes: tarball audit and hidden-split overlap

Every way this audit can fail, written before the code.
`scripts/exp/hidden-audit.test.sh` is the end-to-end check; each row
says which behaviour catches it.

- Tarball missing from the cache: both scripts read the installed
  prefixes under `.exp-cache/` and refuse with a named list when an
  `install.ok` marker is absent. `install.mjs` is the fix; the e2e
  installs its three artifacts first so this path runs on every check.
- Integrity drift: the scan trusts `install.mjs`, which already
  verified the sha512 of each tarball against `versions.json`. A
  registry repack therefore fails at install, before the audit sees
  the files.
- Files that look like answers but are fixtures: `tarball-audit.mjs`
  reports every non-public file that carries answer-shaped content,
  including test fixtures and the generators themselves (a generator
  can regenerate the public answers by design). The CSV names the
  detector that fired (`name`, `keys`, `content`) so a human can sort
  fixtures from leaks; the script never decides that for the reader.
- Filename false positives on "hidden": package code legitimately
  talks about hidden state (`aria-hidden`, hidden layers). The audit
  matches on file *paths*, not file contents, for the hidden-files
  column, so `aria-hidden` inside a source file cannot trip it; a path
  like `src/hidden-state.mjs` still would, and the row is meant to be
  read, not auto-judged.
- Seed regex false positives: prose like "95% interval uses 2,000
  seeded bootstrap resamples" puts a number near the word "seed". The
  scan records the line context (`public` vs `hidden` wording on the
  same line) rather than deciding, and only integers of three or more
  digits count. Example seeds printed as hidden-split illustrations
  land in `doc_hidden_seed_examples`, which is a documentation
  observation, not a shipped-file leak.
- Generator flag drift: the three shipped generators do not share a
  flag spelling (`--output` vs `--out`, optional `--count`). The
  frozen `hidden-census.csv` records the flag spelling found in each
  tarball, and `hidden-overlap.mjs` uses it verbatim; a tarball that
  changes flags fails loudly at generation instead of writing to a
  wrong default path.
- Generator writes inside the package: hidden outputs must never
  land in `.exp-cache/` or the repo. `hidden-overlap.mjs` writes every
  generated split under a temp dir it deletes on exit, passing the
  absolute path through the censused output flag.
- Generator needs the public split at runtime:
  cost-per-task's hidden mode reads `data/tasks.jsonl` next to the
  script to de-duplicate against the public twin. Generation therefore
  runs with the script in place inside its installed prefix; a missing
  public file is silently tolerated by that generator (raw seed output
  is used), which would understate the dedup — the overlap CSV still
  measures the result, and the audit reports the public file's
  presence separately.
- Generator needs network or a paid API: none of the shipped
  generators fetch; if one ever does, the e2e fails at the spawn step
  with the stderr of the child printed.
- Non-deterministic generation: the same seed must give the same
  split. `hidden-audit.test.sh` runs the whole pipeline twice and
  diffs the two CSV trees; a drift fails the run.
- Overlap metrics confuse id suffixes with prefixes: hidden ids can be
  distinct by prefix yet trivially derived (`h-invoice-total-01` vs
  `invoice-total-01`). The CSV carries both `id_exact_overlap` and
  `id_suffix_overlap` so the reader sees prefix distinctness and the
  derived-suffix case separately.
- `expected` is not always a string: episode tasks carry object
  expecteds and some packages carry none. Expected overlap is counted
  only over hidden tasks that have an `expected` field
  (`expected_pairs` is the denominator), serialised with sorted keys
  before hashing; tasks without one never inflate a match.
- Scope limit this audit cannot escape: everything here inspects the
  shipped artifacts. A public-split task can still sit in a model's
  training data; nothing in these CSVs speaks to training-data
  contamination. `paper/data/exp/README.md` says so next to the files.
