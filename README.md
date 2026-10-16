# benchmark-family-paper

Paper, Hugging Face publishing tools and arXiv packet for the `benchmark-*` family of AI benchmarks ([aibenchmarkindex.com](https://aibenchmarkindex.com)).

Work lands through pull requests. The PDF is not committed.

## Paper

The paper is "Agents Can Build Benchmarks. Approvals Missed What Probing Found: 22 Cases".

`paper/data/suite.txt` lists one npm package per line. `scripts/collect.mjs` (plain Node, no dependencies) runs each package and writes `paper/data/suite.json` plus the tables in `paper/generated/`. Those generated files are the only place the paper gets task counts, licences, and mock scores. `paper/data/defects.csv` and `paper/data/review-rounds.csv` hold the review findings the paper quotes; see `paper/data/README.md`.

The paper is set in the official NeurIPS 2026 style with the `preprint` option (non-anonymous, "Preprint." footer). The style file is not committed, per the venue-packaging rule: `scripts/fetch-style.mjs` downloads the official NeurIPS 2026 zip, checks it against a pinned SHA-256, and extracts only `neurips_2026.sty` into `paper/` (git-ignored). `make pdf` and `make arxiv` run the fetch first, and `make arxiv` also copies the `.sty` into the tarball because arXiv does not carry the NeurIPS style.

```bash
node scripts/collect.mjs
make pdf
make arxiv
```

`make pdf` needs [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 on `PATH`. `make arxiv` writes `arxiv/benchmark-family-arxiv.tar.gz` and recompiles that packet. `make release-assets` prints the two paths a GitHub release should attach: the PDF and the tarball. Submission steps are in `arxiv/SUBMIT.md`.

## Hugging Face

`hf/` publishes each package's public task data as a dataset and keeps the collection in sync. See `hf/README.md` and `hf/benchmarks.txt` for the tracked package list.
