# Deviation log for the preregistration (version 1.2, 2026-10-16)

This file records every change to the plan in `PREREGISTRATION.md` (DOI 10.5281/zenodo.23424273), with date and reason. It was written before any real-model score was collected.

## D1. H1 data were collected on the registered plan (no change)

On 2026-10-16 the eight trivial policies ran on all 12 packages at both versions (192 cells, 0 failures). Result, reported as registered: H1 is not supported. T(old) was larger in 2 packages (checkout-consent 0.250 to 0.000, tool-errors 0.212 to 0.000), T(new) was larger in 1 (ranking-stability 0.003 to 0.033), and 9 were tied. One-sided exact sign test p = 0.50 (n = 3). No policy was added after this result.

## D2. A paid run was started and stopped; no paid result exists

At about 12:00 PDT on 2026-10-16 the runner was started with the six paid models of the registered roster. The owner told the author not to spend API money. The run was stopped within about two minutes. No cell of any paid model finished. No paid score was saved or read. The OpenRouter usage counter for the key rose by 0.275 USD between two readings; the key is shared with other jobs, so this number is an upper bound for this study.

## D3. The model roster changed from six paid models to five free models

Reason: the owner's instruction (no paid API use). New roster, in this order of execution, ids exact, access date 2026-10-16:

1. `cohere/north-mini-code:free`
2. `nvidia/nemotron-3-super-120b-a12b:free`
3. `liquid/lfm-2.5-2.6b:free`
4. `nvidia/nemotron-3.5-lightning:free`
5. `dots-studio/dots-3-note-preview:free`

Free models were probed with one short request each before this entry (a one-word reply). The probes' answers were not scored. Not used: `google/gemma-4-26b-a4b-it:free` (the Google route returned a 401 account error), `thinkingmachines/inkling-small:free` (only available to agentic harnesses), `nvidia/nemotron-3-ultra-550b-a55b:free` (too slow to answer a probe in time).

Effect on the claims: H2 and H3 now describe five free models of mixed size, not a cheap commercial roster. They are descriptive. Free hosted models can be swapped, changed or removed by the provider; the study is a dated snapshot.

## D4. Models run through a local proxy

The packages' `openai` provider is used with a local proxy (`free-only-proxy.py`). The proxy refuses any model id that does not end in `:free`, refuses a fallback list with a paid id, spaces calls, counts requests per UTC day (limit 900), and stops the whole run if a response ever reports a nonzero cost. The per-package `openrouter` provider is not used. The score is the same `mean` from `run --json`.

## D5. Stopping rule

The spending cap is moot (planned spend 0 USD; the runner stops if any report shows a cost above 0.001 USD). The run can take several days because of the free daily request limit. Models run in the order of D3. A model with a missing cell at the end is dropped for all packages, as registered. If the run is cut short, the paper reports the models that finished and says so.

## D6. Output cap and reasoning effort for the free models (added 2026-10-16, before any real-model cell finished)

The first free-model calls returned about 13,000 tokens each, because the models reason at length. At about one answer per minute the run would take more than a week. Before any cell had finished, the author set one output cap and one reasoning effort for every real-model request through the proxy: `max_tokens` = 2048 (a request that asks for less keeps its own limit) and reasoning effort `low`. Both apply to all five models and to both versions of every package. The paper reports them. A model that cannot answer within the cap scores what the package grader gives an empty or truncated answer. No cell with a different setting was kept or read. The six calls made before this change were probes, and their answers were not scored.
