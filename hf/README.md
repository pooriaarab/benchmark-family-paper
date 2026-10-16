# Hugging Face publishing

Tools that publish each `benchmark-*` package's public task data to
`huggingface.co/datasets/pooria/<package>` and keep the
[AI Benchmark Index](https://huggingface.co/collections/pooria/ai-benchmark-index)
collection in sync.

## Publish a new benchmark's dataset

1. Add the package name to `benchmarks.txt` (one `benchmark-<id>` per line).
2. Dry run: `python3 hf/publish.py --dry-run`. This clones
   `pooriaarab/<package>` at `main`, builds `hf/out/<package>/` (data split,
   `scripts/gen-tasks.mjs`, dataset card, `croissant.json`) and validates the
   Croissant file with `mlcroissant` (required - the run fails without it).
   Fix the source repo, not the staging folder, when something looks wrong.
3. Publish: `python3 hf/publish.py`. Creates the public dataset repo under
   `pooria/` if missing, merges any fields Hugging Face auto-generated after
   the previous upload into `croissant.json`, uploads the staging folder in
   one commit, and adds the dataset to the collection. Re-running is
   idempotent: `upload_folder` passes `delete_patterns="*"`, so files
   removed from the staging filter are deleted from the Hub on the next
   run.
4. Verify: `python3 hf/verify.py`. Prints `ok` or the failure per dataset.

Use `--only <id>` to process a subset; `publish.py` accepts a
comma-separated or repeated list (`--only pelican,skateboard`). Both tools
skip any listed id that has no npm release yet (`npm view` E404 - a
registry or network error is reported, never silently skipped). `python3
hf/publish.py
--self-test` runs the built-in checks that key/cert/dotfile/hidden/symlinked
data files are refused and that a symlinked `scripts/` directory in a clone
is rejected.

## Requirements

- Python 3.10+ with `huggingface_hub` and `mlcroissant`
  (`pip install --user huggingface_hub mlcroissant`; add
  `--break-system-packages` on PEP 668 managed systems).
- `npx` for `<package> index-entry --json`, `git` for cloning.
- A write token for the `pooria` account in `HF_TOKEN` or
  `~/.config/agents/hf-token`. Never print or commit it.

## Gotchas

- **Hidden splits stay hidden.** Only `.jsonl`, `.json`, `.md`, `.csv` and
  `.txt` files under `data/` are staged; every other extension (keys,
  certs, env files, `.mjs` - scripts only ever ship from `scripts/`) is
  refused and listed. On top of the allowlist, anything matching
  `hidden|secret|private|internal|token|credential|password|apikey|api[_-]?key|holdout`,
  dotfiles, symlinks, and any path that resolves outside the clone is
  dropped too. Hidden splits use a private seed and live outside the public
  repos anyway.
- **Refresh scripts.** `scripts/gen-tasks.mjs` always ships; extra
  `scripts/*.mjs` files referenced by `data/PROVENANCE.md` (for example
  `fetch-prices.mjs` for live-feed sources) ship too.
- **Croissant `@context`.** The context carries every key of the standard
  Croissant 1.0 context (`equivalentProperty` included) plus the RAI terms;
  `mlcroissant` warns when any standard key is missing. `dataType` must map
  `@type: @vocab` so `sc:Text` expands to `https://schema.org/Text`, and
  `license` comes from each package's `package.json` SPDX id - a package
  without a `license` field fails the run rather than defaulting.
  `croissant.json` carries the minimal
  RAI fields (`rai:*`, `prov:wasDerivedFrom`, `prov:wasGeneratedBy`) required
  by the NeurIPS 2026 Evaluations & Datasets hosting guidelines; on re-runs
  it adopts any extra core fields the Hub generated after the previous
  upload.
- **Card facts.** Everything in `README.md` comes from the repo files and
  `npx <package> index-entry --json`; nothing is hand-written per package.
- **Collections are by title.** The sync looks up the collection by title
  under `pooria`; renames break idempotence.
