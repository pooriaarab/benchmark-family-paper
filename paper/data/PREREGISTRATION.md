# Preregistration: trivial-policy and model scores on first-wave benchmark packages, before and after independent review

Author: Pooria Arab (independent researcher). Date: 2026-10-16. Version of this plan: 1. Format: the eight AsPredicted questions (form version 2.00) plus rows for LLM studies.

## 1. Have any data been collected for this study already?

Yes, one pilot. On 2026-10-16 the author ran `benchmark-sycophancy@0.1.0` and `@0.2.0` against a local fake model server that plays eight fixed trivial policies (`trivial-empty`, `trivial-yes`, `trivial-ok`, `trivial-refuse`, `trivial-echo`, `trivial-firsttool`, `trivial-random`, `trivial-nulljson`). Every policy scored 0 on both versions (48 tasks each). Nothing was changed after the pilot. No other package and no real model has been run. The review history (which defects independent reviewers found in which package) is already known to the author and is public in the packages' changelogs, issues and pull requests.

## 2. Main question and hypotheses

The paper claims that approval-style review and green checks did not find defects that adversarial probing found in agent-built benchmarks. This study measures what those defects did to scores.

- **H1 (primary).** A trivial policy that ignores the task scores higher on version 0.1.0 than on version 0.2.0. Per package p and version v, let T(p,v) be the highest mean score among the eight trivial policies. Among the packages with T(p,0.1.0) different from T(p,0.2.0), T(p,0.1.0) is the larger one in more than half. Test: exact one-sided sign test, alpha 0.05. Packages with equal T are reported and left out of the test.
- **H2 (secondary).** Real models score higher on 0.1.0 than on 0.2.0. Per model m, the effect is the mean over packages of S(p,m,0.1.0) minus S(p,m,0.2.0). Report the mean and a 95 percent bootstrap interval (10,000 resamples of packages) per model. No correction across models. These are descriptive.
- **H3 (exploratory).** Model rankings differ between versions. Per package with at least four models completed, report Kendall's tau between the model orderings at the two versions, then the median and range of tau across packages.

The smallest effect we care about for H1 is a difference in T of 0.10 or more in at least half of the packages. We report all three hypotheses even if the result is null.

## 3. Dependent variables

The score is the package's own `mean` from `run --json` (a deterministic grader; no judge model is used). One run per cell. Settings: the package default public split and default seed, the provider's default temperature and top-p (we record them; some models reject non-default temperature), the package's default token limits, no system-prompt changes.

## 4. Conditions

Packages (12 first-wave): pelican, skateboard, apology-pizza, tool-errors, cost-per-task, mcp-safety, test-weakening, checkout-consent, honesty, sycophancy, hundred-step, ranking-stability. Versions: 0.1.0 and 0.2.0, as published on npm on 2026-10-16. The task set can differ between the two versions. That difference is part of what review changed, and we say so in the paper.

Trivial policies (8): see question 1. They run through the same `openai` provider path as real models, against a local server (`trivial-policy-server.py`).

Real models (6, all through OpenRouter, ids exact, access date 2026-10-16), in this order of execution: `mistralai/mistral-nemo`, `inclusionai/ling-3.0-flash`, `meta-llama/llama-3.1-8b-instruct`, `qwen/qwen3.7-flash`, `anthropic/claude-haiku-5.5`, `openai/gpt-5-nano`. The list and the order are fixed now. No model is added after results are seen.

Baselines at both ends: the scripted mock provider's good and bad policies are reported from the packages' own mock run (already in the paper's data).

## 5. Analyses

As in question 2. Standard errors and intervals are over packages (n at most 12), never over tasks across versions, because the task sets differ. Per-package tables show every cell. Figures: a dot plot of T(p,0.1.0) against T(p,0.2.0); a per-model bar of the H2 effect with its interval. Code: `eval-matrix` and `eval-analyze` in `pooriaarab/scripts`, with the commit hash in the paper.

## 6. Exclusions

A cell is one package, one version, one model or policy. If the command exits non-zero, retry once. If it fails again, the cell is missing and is reported. A comparison uses only packages where both of its cells exist. Empty, truncated, refused or malformed model answers are scored by the package grader as it stands; we do not edit or drop them. We never drop a task because of a score.

## 7. Sample size and stopping rule

12 packages x 2 versions x 8 trivial policies, and 12 x 2 x 6 models, one run each. Spending cap on OpenRouter: 3.50 USD. A model is run in the fixed order of question 4. If the next model would not finish inside the cap or the remaining account credit falls below 0.30 USD, we stop and drop that model for all packages (no partial models). We do not add tasks, seeds or repeats after seeing results.

## 8. Anything else

- Contamination: not studied. Risk stated in the paper.
- Provider routing on OpenRouter is not pinned; we record the response `model` field when it exists and the date. Hosted model versions can change; results are a dated snapshot.
- Conflict of interest: the author built and reviewed the packages and pays for compute.
- Release: raw reports, ledger, prompts and the analysis script are released with a checksum. Every change after this registration goes into a deviation log with date and reason.
- A null or reversed result is reported as such.
