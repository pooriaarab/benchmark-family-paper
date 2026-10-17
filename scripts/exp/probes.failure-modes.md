# Contract probe freeze failure modes

Every way this freeze step can fail, written before the probe list, the
oracle table, the applicability table, and the check script.
`scripts/exp/probes-check.mjs` is the end-to-end check;
`scripts/exp/probes.test.sh` runs it twice and compares the output.

## Promise provenance

- A promise cited from a private or post-hoc document: the honest
  variant list may only cite text published inside a pinned npm
  artifact (`README.md`, `docs/`, `CHANGELOG.md`, `llms.txt`, or
  shipped source text such as tool descriptions). A template or
  protocol written after the tarballs is result-derived. The check
  rejects any occurrence of the strings `DEFECT-CLASSES` or
  `REVIEW-PROTOCOL` in the frozen files, and every `promise_source`
  must resolve to a file inside the installed artifact under
  `.exp-cache/` (or `--cache`).
- A promise quote that does not appear in the tarball: the check
  requires the quoted sentence verbatim (whitespace collapsed) in the
  cited file, with its opening text on the cited line or its wrapped
  continuation lines.
- A promise cited for the wrong version: the contract differs between
  0.1.0 and 0.2.0 (skateboard accepts a fence only at 0.2.0).
  `promise_source` entries carry the version, and an `applies: yes`
  cell is rejected when no `promise_source` covers that artifact.
- An honest transform with no published promise anywhere: it becomes
  `unpromised-exploratory`, not `honest-variant`. A probe of that kind
  may never carry an `applies: yes` cell and a run report may never
  count its failures as grader defects. The check enforces both
  directions.

## Attack rules

- A rule that cannot fail: `score(probe) <= score(oracle) + 0.001`
  passes trivially wherever the oracle scores 1, since core caps
  scores at 1. Attacks are split by construction. TYPE A replaces the
  graded carrier with content that has no valid solution and fails
  above `score(empty submission) + 0.001`. TYPE B wraps the oracle
  submission and fails when the score moves more than `0.001` in
  either direction. The check rejects an attack with no `type`, or
  whose `expected` does not carry its type's numeric rule.
- An ambiguous `empty` or `oracle`: `empty` is the submission `{}` on
  the same task; `oracle` is the submission the package's good mock
  policy produces, defined per artifact in
  `paper/data/exp/oracle-definition.csv`. A probe that edits answer
  text is `outside contract` where the oracle sends no answer text;
  the check ties the `oracle_sends_answer` flag to those cells.

## Applicability table

- A row that hides a version split: the CSV carries one row per pinned
  artifact (package and version columns); the check fails if any
  pinned artifact lacks a row or a row names an unpinned artifact.
- A cell that claims more than the cell scope: a transform that fits
  only some tasks (the ordering family inside ranking-stability, a
  decline goal inside payment-delegation) records
  `applies-to-tasks: <selector>` in the cell; the runner scores only
  that subset.
- An empty or malformed cell: every cell is `yes`, `exploratory`, or
  `no`, followed by ` - ` and a reason; anything else fails.
  `exploratory` is allowed only on honest-variant columns (including
  `unpromised-exploratory` ones); attacks take only `yes` or `no`.
- A cell that decides from results: cells derive from the published
  task shape and oracle carrier only. No probe is run and no score is
  read in this freeze; a cell written after seeing results would be
  post hoc.
- A package whose submission format cannot be derived: when the README
  and the shipped grader disagree, the grader source in the installed
  tarball at the pinned version wins, and the reason column says so.
- CSV fragility: reasons use plain words with no commas or quotes, so
  cells stay unquoted and the check can split rows on commas alone.

## Coverage and drift

- A probe id with no column, or a column with no probe: the check
  compares the CSV header against `probes.json` both ways.
- versions.json growth: a new pinned artifact fails the row-count
  check until a row is decided from that artifact's contract.
- Engine drift: all 34 artifacts depend on `benchmark-core@^0.1.0`.
  If a newer engine ships before the run PR, the Trace contract and
  the route limits re-read from its README, not from this file.
- The freeze is edited after the run PR opens: the check prints the
  sha256 of the frozen files so the run PR can pin the hash it
  executed. `probes.test.sh` runs the check twice and diffs the
  output, so a nondeterministic check fails loudly.
- A missing cache: `probes.test.sh` installs exactly the cited
  artifacts into a temp cache; a cache that lacks one fails by name.
