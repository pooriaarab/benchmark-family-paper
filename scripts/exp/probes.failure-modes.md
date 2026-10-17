# Contract probe freeze failure modes

Every way this freeze step can fail, written before the probe list, the
applicability table, and the check script. `scripts/exp/probes-check.mjs`
is the end-to-end check; each row says which check or behaviour catches
it.

- A probe the family spec does not promise: an honest variant that
  normalises something `benchmark-template` `docs/DEFECT-CLASSES.md`
  class 3 and `docs/REVIEW-PROTOCOL.md` never ask a grader to accept
  would measure the author, not the packages. Every honest-variant
  probe in `probes.json` carries a `source` field naming the document
  that promises it; a probe without a source is rejected by review,
  and `probes-check.mjs` fails if the field is missing.
- An applicability decision that depends on results: the table must be
  decidable from the published contract alone (task kind, which
  submission fields the grader reads, whether the answer format can
  carry the transform). Nothing in this PR runs a probe or reads a
  score; a decision written after seeing results would be post hoc.
  The freeze commit lands before any run, so the git timestamp is the
  only registration the plan asks for.
- A package whose submission format cannot be derived: when the README
  and the shipped grader disagree, the grader source in the installed
  tarball at the pinned version wins, and the reason column says so.
  The pinned version is `versions.json`, not latest on npm.
- An ambiguous transform: each `transform` string is written so two
  implementers produce the same submission bytes (fixed prose, fixed
  candidate order rules, fixed byte counts). `probes-check.mjs` fails
  on an empty or placeholder transform.
- A missing `expected`: every probe states what accept means
  numerically relative to the oracle score. `probes-check.mjs` fails
  if `expected` is absent or carries no tolerance number.
- An empty applicability cell: the CSV is a full 22 by probe matrix;
  `probes-check.mjs` fails on any empty cell, any `applies` token that
  is not `yes` or `no`, or any cell without a reason.
- A package outside versions.json: `probes-check.mjs` fails if a CSV
  row names a package that `versions.json` does not pin, or if a
  pinned package has no row.
- A probe id with no column, or a column with no probe: the check
  compares the CSV header against `probes.json` both ways.
- Engine drift: all 34 artifacts depend on `benchmark-core@^0.1.0` and
  0.1.0 is the only published version as of 2026-10-17. If a newer
  engine ships before the run PR, the Trace contract and the route
  limits re-read from its README, not from this file.
- versions.json growth: if the pin list gains a 23rd package, the
  check fails because the matrix no longer covers every pinned
  package; the fix is a new row decided from that package's contract,
  not a rerun.
- CSV fragility: reasons use plain words with no commas, so cells stay
  unquoted and `probes-check.mjs` can split rows on commas alone.
- The freeze is edited after the run PR opens: the check prints the
  sha256 of both files so the run PR can pin the hash it executed.
