# benchmark-pelican

[![npm](https://img.shields.io/npm/v/benchmark-pelican)](https://www.npmjs.com/package/benchmark-pelican) [![downloads](https://img.shields.io/npm/dm/benchmark-pelican)](https://www.npmjs.com/package/benchmark-pelican) [![license](https://img.shields.io/npm/l/benchmark-pelican)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://aibenchmarkindex.com/benchmarks/benchmark-pelican) · [npm](https://www.npmjs.com/package/benchmark-pelican) · [Grading](./docs/grading.md) · [MCP](#model-context-protocol) · [HTTP API](#http-api)

benchmark-pelican is an open-source AI benchmark for SVG drawing and spatial reasoning. It asks models to draw birds riding bicycles, then checks the markup and geometry without a model judge.

```bash
npx benchmark-pelican run --provider mock
```

```json
{"model":"mock:1","mean":0.43333333333333335,"confidenceInterval95":{"low":0.26666666666666666,"high":0.6},"totals":{"tasks":30,"passed":13,"failed":0},"checkSummary":[{"check":"beak","passRate":1,"meanContribution":1}]}
```

The public set has one human-written canonical prompt and 29 tasks from a seeded animal and bicycle grid. The repository script creates every prompt, required-parts list, and mock reference SVG.

## Install

benchmark-pelican requires Node.js 20 or newer.

```bash
npm install benchmark-pelican
```

## Run your first benchmark

The mock provider uses no key or network call. Its fixed mix of good and bad drawings proves both grading paths.

```bash
npx benchmark-pelican run --provider mock
```

The command prints 30 task rows, a mean score, and a bootstrap 95% confidence interval. A score of 1 means every structural check passed. Partial credit identifies missing geometry in the reason field.

Run a real model through OpenRouter:

```bash
export OPENROUTER_API_KEY="your-key"
npx benchmark-pelican run --provider openrouter --model openai/gpt-5
```

The process exits successfully after all rows are graded. Save JSON with `--json > report.json` to create cards or galleries.

## How it works

```text
seeded tasks -> model SVG -> safety scan -> geometry checks -> scored report
                                      |-> CLI / SDK / MCP / HTTP API
```

The scanner rejects malformed, active, external, or oversized SVG. The score multiplies a shared-structure gate by a task-specific fit: each task names its required parts in the prompt, and a missed or unrequested part scales the score down. A drawing of the wrong bird cannot ride the shared checks to a high score.

Every prompt states each checked part in plain terms, with the real numbers where a check needs one. An independent reviewer's literal-number policy — reads only the prompt, legs ending 0.2 wheel radii above to 0.3 below the axle line, jittered body and handlebar proportions, tail fans 0.42-0.6 wheel radii tall, 30 runs per split at 1000x600 and 640x480 — measured a mean of 0.992 with runs 0.980-1.000 and 29-30 of 30 tasks at 0.8 or above on the public split; 0.999 (0.980-1.000) and 29-30 on held-out seed 7; 0.998 (0.973-1.000) and 29-30 on seed 99; 0.983 (0.960-1.000) and 28-30 on seed 4242. The builder's own literal-number policy (`scripts/literal-policy.mjs` — the builder's smoke policy; not independent evidence) scores a mean of 1.000 on the same splits. Tail fans 0.42R to 0.7R tall all score exactly 1.0 on every tail task, so the stated 0.4R is the real threshold.

## Why it exists

Simon Willison [popularised the pelican-on-a-bicycle prompt](https://simonwillison.net/2024/Oct/25/pelicans-on-a-bicycle/) as a quick visual model comparison. This package turns that delightful test into a repeatable public benchmark.

A screenshot contest is easy to understand but hard to reproduce. benchmark-pelican keeps tasks, provenance, grading code, and report surfaces in one versioned package.

## Compare

Checked on 2026-10-15.

| Property | benchmark-pelican | One-off prompt test | Vision-model judge |
| --- | --- | --- | --- |
| Task set | 30 versioned prompts | Usually one prompt | Depends on suite |
| Headline grading | Local deterministic scan | Human inspection | Model call |
| Offline run | Yes | Depends on model | No |
| Reasons | Per-check pass and miss list | Informal notes | Judge explanation |
| Main blind spot | Visual semantics | Reviewer variation | Judge variation and cost |

## Coverage

| Surface | Included | E2E check |
| --- | --- | --- |
| TypeScript SDK | Yes | Run and direct score |
| Command-line interface | Yes | Every command |
| Model Context Protocol server | Yes | Every tool |
| Fetch-style HTTP API | Yes | Every route |
| OpenRouter adapter | Yes | Key-free path not possible |
| OpenAI-compatible adapter | Yes | Key-free path not possible |
| Offline mock adapter | Yes | All 30 tasks |

The local gate checks every package surface. It does not make paid provider calls.

## Common use cases

1. **Model releases:** compare SVG structure before and after a model change.
2. **Prompt research:** use a private seed to test whether results survive wording changes.
3. **Agent tooling:** call deterministic scoring through Model Context Protocol (MCP).
4. **Evaluation pipelines:** serve the same tasks and scores through a fetch handler.
5. **Demos:** turn saved reports into an HTML gallery and SVG share card.

## Features

- **Deterministic score:** Run the same SVG through the same weighted checks.
- **Inspectable data:** Rebuild the public JSON Lines file with seed `20261015`.
- **Adversarial gate:** Empty, constant, refusal, tool-call-only, and abstract-shape answers must score at or below 0.2 on every task.
- **Safe previews:** Reject scripts, external images, event handlers, and remote references.
- **Share output:** Put a passing submitted drawing beside its model score.

## SDK

```ts
import { benchmark, run, score } from "benchmark-pelican";
```

`run(adapter, options)` returns a benchmark-core report extended with `checkSummary` (pass rate per check) and per-row `details`. Pass `tasksPath` in options or call `createBenchmark(path)` to run a generated split file. `score(taskId, submission, options)` grades one SVG trace and accepts the same `tasksPath` override.

## CLI

Commands are `list`, `show`, `run`, `score`, `card`, `provenance`, `index-entry`, `serve`, and `mcp`. Add `--json` for machine-readable output and `--tasks <path>` to point any command at a split file, such as one generated by `node scripts/gen-tasks.mjs --split hidden`.

```bash
npx benchmark-pelican card report.json card.svg
npm run gallery -- report.json another-report.json
```

The gallery command writes `artifacts/gallery.html` from saved reports.

## Model Context Protocol

Start the MCP stdio server:

```bash
npx benchmark-pelican mcp
```

Tools are `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, and `get_provenance`.

## HTTP API

Import `handler` from `benchmark-pelican/api`, or run `npx benchmark-pelican serve`. Routes are `GET /health`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/score`, `GET /v1/provenance`, and `GET /v1/index-entry`.

## Data provenance

`data/tasks.jsonl` holds the public set. `node scripts/gen-tasks.mjs --split hidden` writes to `hidden/`, which stays out of the package. `data/PROVENANCE.md` records source kinds, licences, the cutoff, regeneration steps, and the hidden split plan.

```bash
npm run generate:tasks
node scripts/gen-tasks.mjs --seed 9173 --split hidden --output /secure/path/tasks.jsonl
```

Keep hidden tasks outside the repository and package. Review public data yearly; change its seed only for a declared data version.

## Limits and known weaknesses

The grader checks structure, not visual truth. It verifies that the parts each prompt names are present and shaped plausibly; it cannot prove species, posture, occlusion, or artistic quality. The "does it look like a pelican" question belongs to the optional vision judge, which stays off by default and unscored. Carefully chosen abstract geometry can pass.

Complex transforms, CSS, nested viewports, and unusual path commands can lose credit. Public prompts may enter training data. Remote providers can retain prompts and report cost under their own terms.

A beak must be a filled shape; a stroke-only orange curve is not read as a beak. Several prompt numbers are looser than the grader's real thresholds — a large beak 0.34 head-widths deep fails (the grader needs 0.35), a hooked beak over 0.85 head-widths long reads as thin curved, a tall beak 0.52 deep fails (the grader needs 0.55), and a body taller than 0.9 of its width reads as upright — so draw with a margin. Beak depth is unstated: a pointed beak 0.2 head-widths deep reads as flat, and a deep long or thin beak reads as large. A yellow body on a short-neck task, or any warm shape touching the head, can join the beak and lower the score — 201 of 213 measured yellow-body drawings scored 0.16.

The optional vision judge is not implemented. No public leaderboard exists yet because this release did not run paid models.

## Integration guides

- [Structural grading rules and failure modes](./docs/grading.md)
- [Benchmark data and regeneration record](./data/PROVENANCE.md)
- [AI Benchmark Index entry](https://aibenchmarkindex.com/benchmarks/benchmark-pelican)

## Status

Version 0.2.0 is alpha. Task wording and heuristic weights can change before 1.0. Report defects through the [GitHub issue tracker](https://github.com/pooriaarab/benchmark-pelican/issues). Public case studies are not yet published.

## FAQ

### What does benchmark-pelican measure?

benchmark-pelican measures whether a model can produce safe SVG with plausible bird and bicycle geometry. The headline score is deterministic and structural: a shared gate times a task-specific fit, so a drawing must match the animal and vehicle the prompt names.

### How does benchmark-pelican grade an SVG?

benchmark-pelican scans XML balance, safety, element count, geometry, color, and coverage. The [grading guide](./docs/grading.md) lists all weights and known failure modes.

### Can benchmark-pelican run offline?

benchmark-pelican runs end to end with the mock provider and no key. Real model runs require OpenRouter or an OpenAI-compatible endpoint.

### Which integrations are verified?

benchmark-pelican verifies the SDK, CLI, MCP server, HTTP API, and mock adapter in E2E. Paid provider adapters are supplied by benchmark-core and are not called by this repository gate.

### Does benchmark-pelican provide a managed benchmark service?

benchmark-pelican provides a server you run. It does not operate a managed endpoint.

### Where do benchmark-pelican tasks come from?

benchmark-pelican uses one human-written canonical prompt and a synthetic seeded grid. It copies no third-party dataset text.

### How is benchmark-pelican different from a one-off prompt test?

benchmark-pelican versions 30 tasks and applies the same published grader to each answer. A one-off test usually relies on a viewer's judgement.

### Can benchmark-pelican use a hidden split?

benchmark-pelican generates a hidden JSON Lines file from a private seed. Keep the seed and output outside public source control.

### Does benchmark-pelican know whether the drawing looks good?

benchmark-pelican does not measure beauty. It finds structural evidence and reports uncertainty through named misses and documented limits.

## License

[MIT](LICENSE) © Pooria Arab

## Cite

Please cite this package with its Zenodo DOI. The DOI below names all versions. GitHub also shows a "Cite this repository" box from `CITATION.cff`.

```bibtex
@software{arab2026benchmarkpelican,
  author  = {Arab, Pooria},
  title   = {benchmark-pelican},
  year    = {2026},
  version = {0.2.0},
  doi     = {10.5281/zenodo.23422362},
  url     = {https://aibenchmarkindex.com/benchmarks/benchmark-pelican}
}
```
