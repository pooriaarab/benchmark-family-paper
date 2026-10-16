# benchmark-family-paper

Paper, Hugging Face publishing tools and arXiv packet for the `benchmark-*` family of AI benchmarks ([private-repo-337e.com](https://private-repo-337e.com)).

Work lands through pull requests. The PDF is not committed.

## Paper

`paper/data/suite.txt` lists one npm package per line. `scripts/collect.mjs` (plain Node, no dependencies) runs each package and writes `paper/data/suite.json` plus the tables in `paper/generated/`. Those generated files are the only place the paper gets task counts, licences, and mock scores.

```bash
node scripts/collect.mjs
make pdf
```

`make pdf` needs [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 on `PATH`. `make release-assets` prints the paths a GitHub release should attach.
