# arXiv submission notes

Do not submit from this machine. arXiv needs the owner's login, and a first-time submitter in `cs.*` needs an endorsement. The packet is the tarball from `make arxiv`. The lead attaches that tarball and `paper/main.pdf` to GitHub release `v0.1.0`. This file does not create the release.

## Build the packet

Tectonic 0.17.0 must be on `PATH`. The checksum checked on this machine for `tectonic-0.17.0-x86_64-unknown-linux-gnu.tar.gz` is `1a715688baf591e650c8aeb160ae934e181685eecbb38b317de30b269ac5d606`.

The paper uses the official `neurips_2026.sty` with the `preprint` option. The style is fetched, not committed: `make pdf` and `make arxiv` run `node scripts/fetch-style.mjs` first, which downloads `Formatting_Instructions_For_NeurIPS_2026.zip` from media.neurips.cc, verifies it against the SHA-256 pinned in the script, and extracts only `neurips_2026.sty` into `paper/`.

```bash
node scripts/collect.mjs
make pdf
make arxiv
make release-assets
```

`make arxiv` runs `node scripts/submit-md.mjs` and then `node scripts/arxiv.mjs`, after fetching the style. The first refreshes the title and abstract blocks below from `main.tex`; the second compiles `paper/main.tex` with `--keep-intermediates`, flattens every `\input` to the archive root, writes `main.bbl` beside `refs.bib`, copies the three figure-data CSVs flat (`review-rounds.csv`, `defects-plot.csv`, `mock-scores.csv`), adds `neurips_2026.sty` (arXiv does not carry the NeurIPS style), and rejects anything that is not `.tex`, `.bib`, `.bbl`, `.sty`, or `.csv`. It then unpacks `arxiv/benchmark-family-arxiv.tar.gz` in a temp directory and compiles that copy. The tarball is gitignored.

A NeurIPS submission would look different: the Evaluations and Datasets track uses `\usepackage[eandd]{neurips_2026}` instead of `[preprint]` and adds `checklist.tex` (the NeurIPS paper checklist) from the same zip. arXiv needs neither, so the checklist is not in this packet.

## Metadata to paste

Title:

```text
Agents Can Build Benchmarks. Approvals Missed What Probing Found: 22 Cases
```

Authors:

```text
Pooria Arab
```

Abstract (plain text, macros expanded by `scripts/submit-md.mjs` from the generated files):

```text
We report 22 agent benchmarks built by AI coding agents on one shared TypeScript engine. No test job failed on the last commit of any of the 123 merged feature pull requests, and the LLM council that reviewed them approved 94 of the 123 merged feature pull requests. A later probing review still found defects in all 22: each needed at least one fix round (median 3, maximum 9), the first 12 shipped a release whose changelog marks earlier scores incomparable (a sentence the fix briefs required, over real scoring changes), and at least 13 packages record a strategy that ignored the task and still earned credit. A preregistered check then played eight generic trivial policies against the first 12 packages before and after the fixes: the best trivial score fell in only two packages, a null that shows generic policies miss most of the logged defects. The approvals were real reviews: the council flagged defects that were then fixed, including the published hidden seed in sycophancy's pull request 20 and gaps in pelican's SVG scan. And one approved request is documented holding a defect that the probing review later found: pelican's pull request 4, approved by the chair alone after the other members timed out, shipped a grader that scored a memorised SVG 1.0 on every task (issue 8). The artifact behind the suite is benchmark-core: one defineBenchmark call builds a task runner, a deterministic grader, and four runnable surfaces (SDK, CLI, MCP, HTTP) per package, and a mock provider separates an oracle script from a trivial script offline. We release the engine, the packages, the re-review protocol and review log, and the defect counts with their public sources. This release reports no real-model results and keeps no leaderboard; the registered real-model arm is still running.
```

If `suite.txt` gains a package or the paper text changes, rerun `node scripts/submit-md.mjs`; editing the title or abstract block by hand will drift from `main.tex`.

Comments:

```text
22 agent-built benchmark packages on one shared engine; council approvals versus probing review, with a preregistered trivial-policy check (H1 null). Mock-provider and trivial-policy validation only; the registered real-model arm is still running. No public model leaderboard in this version.
```

Categories:

- Primary: `cs.AI`
- Cross-list candidates: `cs.SE`, `cs.LG`

Leave MSC and ACM class empty.

Licence: CC BY 4.0 for the paper text. The code in the benchmark repositories stays MIT. On the arXiv form, choose the CC BY 4.0 licence, not the arXiv non-exclusive licence alone, so the deposit matches the statement in the paper.

## Endorsement

arXiv will not accept a new author into `cs.*` without an endorsement, and an independent author with no institutional email or prior claimed papers needs a personal endorser: an established arXiv author who knows the work. Ask for it before the first submit. Since 1 October 2026, arXiv also caps each submitter at two new submissions per calendar month, so the whole benchmark family goes in this one paper rather than one paper per package. This environment has no logged-in arXiv session in the browser, so stop after the tarball is built.

## Checklist

- [ ] `make arxiv` printed `-> arxiv packet, ok` and the proof PDF opened from the unpacked tarball.
- [ ] The archive root is flat: `main.tex`, the section files, the generated tables, the three figure-data CSVs, `refs.bib`, `main.bbl`, `neurips_2026.sty`. No PDF, no SVG, no Markdown, no JSON, no log, no `checklist.tex`.
- [ ] Every `refs.bib` entry has a `url` or `doi` that resolves.
- [ ] Title, author, and abstract on the form match this file.
- [ ] Primary category `cs.AI`. Candidates `cs.SE` and `cs.LG` only if the form asks for cross-lists.
- [ ] MSC and ACM left blank.
- [ ] Licence set to CC BY 4.0.
- [ ] Upload `arxiv/benchmark-family-arxiv.tar.gz`, not `paper/main.pdf`.
- [ ] Read the arXiv preview. Confirm the tables and the bibliography rendered.
- [ ] Endorsement is in place if this account has never announced in `cs.*`.
- [ ] Do not submit until the owner has read the preview.
