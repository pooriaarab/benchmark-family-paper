# arXiv submission notes

Do not submit from this machine. arXiv needs the owner's login, and a first-time submitter in `cs.*` needs an endorsement. The packet is the tarball from `make arxiv`. The lead attaches that tarball and `paper/main.pdf` to GitHub release `v0.1.0`. This file does not create the release.

## Build the packet

Tectonic 0.17.0 must be on `PATH`. The checksum checked on this machine for `tectonic-0.17.0-x86_64-unknown-linux-gnu.tar.gz` is `1a715688baf591e650c8aeb160ae934e181685eecbb38b317de30b269ac5d606`.

```bash
node scripts/collect.mjs
make pdf
make arxiv
make release-assets
```

`make arxiv` runs `node scripts/arxiv.mjs`. That script compiles `paper/main.tex` with `--keep-intermediates`, flattens every `\input` to the archive root, writes `main.bbl` beside `refs.bib`, and rejects anything that is not `.tex`, `.bib`, or `.bbl`. It then unpacks `arxiv/benchmark-family-arxiv.tar.gz` in a temp directory and compiles that copy. The tarball is gitignored.

## Metadata to paste

Title:

```text
benchmark-core and the AI Benchmark Index: deterministic, reproducible agent benchmarks with four surfaces
```

Authors:

```text
Pooria Arab
```

Abstract (plain text, macros expanded from the collector that wrote `paper/generated/macros.tex`):

```text
benchmark-core is a TypeScript engine for agent benchmarks. 12 packages publish on top of it. Each package is one task set, one deterministic grader, a provenance record, and four runnable surfaces: an SDK, a command-line interface, an MCP server, and an HTTP handler. The numbers in the paper come from scripts/collect.mjs, which runs the packages named in paper/data/suite.txt. A mock provider separates a scripted good policy from a scripted bad policy on every package. This release has no public model leaderboard. Results on real models are future work.
```

If `suite.txt` gains a package, regenerate the tables and edit the "12" in this abstract before uploading.

Comments:

```text
Resource and evaluation-infrastructure paper. Mock-provider validation only. No public model leaderboard in this version.
```

Categories:

- Primary: `cs.AI`
- Cross-list candidates: `cs.CL`, `cs.LG`

Leave MSC and ACM class empty.

Licence: CC BY 4.0 for the paper text. The code in the benchmark repositories stays MIT. On the arXiv form, choose the CC BY 4.0 licence, not the arXiv non-exclusive licence alone, so the deposit matches the statement in the paper.

## Endorsement

arXiv will not accept a new author into `cs.AI`, `cs.CL`, or `cs.LG` without an endorsement from someone who has already published in that category. Ask for it before the first submit. A rejected automatic submit wastes the attempt. This environment has no logged-in arXiv session in the browser, so stop after the tarball is built.

## Checklist

- [ ] `make arxiv` printed `arxiv packet ok` and the proof PDF opened from the unpacked tarball.
- [ ] The archive root is flat: `main.tex`, the section files, the generated tables, `refs.bib`, `main.bbl`. No PDF, no SVG, no Markdown, no JSON, no log.
- [ ] Every `refs.bib` entry still has a `note` with a URL or DOI that resolves.
- [ ] Title, author, and abstract on the form match this file.
- [ ] Primary category `cs.AI`. Candidates `cs.CL` and `cs.LG` only if the form asks for cross-lists.
- [ ] MSC and ACM left blank.
- [ ] Licence set to CC BY 4.0.
- [ ] Upload `arxiv/benchmark-family-arxiv.tar.gz`, not `paper/main.pdf`.
- [ ] Read the arXiv preview. Confirm the tables and the bibliography rendered.
- [ ] Endorsement is in place if this account has never announced in `cs.*`.
- [ ] Do not submit until the owner has read the preview.
