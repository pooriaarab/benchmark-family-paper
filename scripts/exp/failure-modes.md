# Experiment scaffold failure modes

Every way this scaffold fails, written before the code.
`scripts/exp/scaffold.test.sh` is the end-to-end check; each row says
which check or behaviour catches it.

- npm registry down or unreachable: `install.mjs` fails the tarball
  download with a nonzero exit and names the artifact. The cache is
  content-addressed, so a retry picks up where the failed run stopped;
  `scaffold.test.sh` exercises this path on every run because it needs
  the registry to pass.
- Version unpublished after pinning: a yanked or unpublished version
  makes `npm view` or the tarball fetch return 404/410. `versions.json`
  was generated from `npm view <pkg> versions --json` on 2026-10-17,
  and `install.mjs` reports which pin no longer resolves.
- Integrity mismatch: the downloaded tarball does not match the pinned
  `dist.integrity` sha512 (registry repack, mirror corruption, a
  man-in-the-middle). `install.mjs` hashes every tarball itself and
  exits nonzero naming the artifact and both digests; it never installs
  a mismatched artifact.
- Disk full mid-install: an `ENOSPC` during extract aborts that
  artifact, leaves a partial directory, and exits nonzero. The partial
  directory carries no `install.ok` marker, so the next run removes and
  re-extracts it; see the next row.
- Partial install: an interrupted run (killed process, host restart)
  leaves an extracted tree without its `install.ok` marker file.
  `install.mjs` is idempotent: an artifact is treated as installed only
  when the marker exists, and a marker-less tree is always rebuilt.
- Cache directory collision: `.exp-cache/` is gitignored and local.
  Two experiment scripts pointing at the same cache is safe because
  installs are idempotent, but nothing stops a user from deleting the
  cache between runs; scripts treat the cache as rebuildable state only.
- Package shape drift: the test assumes each artifact exposes a
  `benchmark` export with `listTasks()` and a `benchmark-<name>` bin
  that accepts `run --provider mock --json`. If a pinned package breaks
  that contract, `scaffold.test.sh` fails at the `node -e` import step
  or the `npx` step and prints the package name.
- Vendored server drift: `trivial-policy-server.py` is vendored at a
  pinned source commit (see its header comment). If upstream fixes the
  server, the vendored copy does not move; that is deliberate, so runs
  stay reproducible. Refresh is a manual step, not automatic.
- Port already taken: `scaffold.test.sh` asks the OS for a free port
  (bind to port 0) and passes it to the server, so a busy port fails
  only if the OS hands the port to another process in the gap; the
  retry is to run the script again.
- Python missing or wrong version: the vendored server needs Python 3;
  the test fails loudly at server start with the interpreter error.
- npx cache surprises: `npx benchmark-<name>` inside a cache package
  must resolve the local install, not fetch a fresh copy. The test runs
  npx with the cache `node_modules/.bin` on `PATH` and `--no-install`
  semantics off the local tree; a miss fails the run rather than
  silently downloading an unpinned version.
