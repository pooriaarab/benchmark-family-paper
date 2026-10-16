# benchmark-family-paper

Paper, Hugging Face publishing tools and arXiv packet for the `benchmark-*` family of AI benchmarks ([aibenchmarkindex.com](https://aibenchmarkindex.com)).

Work lands through pull requests. The PDF is not committed.

## Paper

`paper/data/suite.txt` lists one npm package per line. `scripts/collect.mjs` (plain Node, no dependencies) runs each package and writes `paper/data/suite.json` plus the tables in `paper/generated/`. Those generated files are the only place the paper gets task counts, licences, and mock scores.

```bash
node scripts/collect.mjs
make pdf
make arxiv
```

`make pdf` needs [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 on `PATH`. `make arxiv` writes `arxiv/benchmark-family-arxiv.tar.gz` and recompiles that packet. `make release-assets` prints the two paths a GitHub release should attach: the PDF and the tarball. Submission steps are in `arxiv/SUBMIT.md`.
