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
   Croissant file with `mlcroissant` when it is installed. Fix the source repo,
   not the staging folder, when something looks wrong.
3. Publish: `python3 hf/publish.py`. Creates the public dataset repo under
   `pooria/` if missing, uploads the staging folder, merges the core fields
   Hugging Face auto-generates into `croissant.json`, and adds the dataset to
   the collection. Re-running is idempotent.
4. Verify: `python3 hf/verify.py`. Prints `ok` or the failure per dataset.

Use `--only <id>` on both scripts to process a single benchmark.

## Requirements

- Python 3.10+ with `huggingface_hub` (`pip install --user huggingface_hub`;
  add `--break-system-packages` on PEP 668 managed systems). `mlcroissant` is
  optional but recommended.
- `npx` for `<package> index-entry --json`, `git` for cloning.
- A write token for the `pooria` account in `HF_TOKEN` or
  `~/.config/agents/hf-token`. Never print or commit it.

## Gotchas

- **Hidden splits stay hidden.** Anything matching
  `hidden|secret|private|token|credential|password|api[_-]key` under `data/`
  (plus dotfiles) is never staged. Hidden splits use a private seed and live
  outside the public repos anyway.
- **Refresh scripts.** `scripts/gen-tasks.mjs` always ships; extra
  `scripts/*.mjs` files referenced by `data/PROVENANCE.md` (for example
  `fetch-prices.mjs` for live-feed sources) ship too.
- **Croissant `@context`.** `mlcroissant` warns unless the full Croissant 1.0
  context is present; `dataType` must map `@type: @vocab` so `sc:Text`
  expands to `https://schema.org/Text`. `croissant.json` carries the minimal
  RAI fields (`rai:*`, `prov:wasDerivedFrom`, `prov:wasGeneratedBy`) required
  by the NeurIPS 2026 Evaluations & Datasets hosting guidelines, then adopts
  any extra core fields the Hub generates after upload.
- **Card facts.** Everything in `README.md` comes from the repo files and
  `npx <package> index-entry --json`; nothing is hand-written per package.
- **Collections are by title.** The sync looks up the collection by title
  under `pooria`; renames break idempotence.
