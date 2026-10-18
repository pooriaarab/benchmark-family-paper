# Build the benchmark-family paper.
# Tested with Tectonic 0.17.0 (x86_64-unknown-linux-gnu).
# The NeurIPS style is fetched, never committed: scripts/fetch-style.mjs
# downloads the official zip, pins its SHA-256, and extracts the .sty.

TECTONIC ?= tectonic
export TECTONIC

.PHONY: collect pdf arxiv release-assets clean style reports

reports: style
	@test -n "$(PKG)" || { echo "make reports: set PKG=<package|all>" >&2; exit 2; }
	node scripts/pkg-reports.mjs $(PKG)

style:
	node scripts/fetch-style.mjs

collect:
	node scripts/collect.mjs

pdf: style
	cd paper && $(TECTONIC) main.tex

arxiv: style
	node scripts/submit-md.mjs
	node scripts/arxiv.mjs

release-assets:
	@echo "$(CURDIR)/paper/main.pdf"
	@echo "$(CURDIR)/arxiv/benchmark-family-arxiv.tar.gz"

clean:
	rm -f paper/main.pdf paper/main.aux paper/main.log paper/main.bbl \
		paper/main.blg paper/main.out paper/main.toc paper/neurips_2026.sty \
		paper/main-dmlr.pdf paper/supplement-dmlr.pdf paper/dmlr-source.tar.gz

# DMLR submission build: the same paper on the official dmlr2e style
# plus the supplementary PDF DMLR asks for on benchmark submissions.
# The .tex files set \input@path to paper/dmlr themselves.

.PHONY: dmlr dmlr-style dmlr-supplement dmlr-source dmlr-test

dmlr-style:
	node scripts/fetch-dmlr-style.mjs

dmlr: dmlr-style
	cd paper && $(TECTONIC) main-dmlr.tex

dmlr-supplement: dmlr-style
	node scripts/gen-dmlr-supplement.mjs
	cd paper && $(TECTONIC) supplement-dmlr.tex

# Source archive for the OpenReview upload (tex, style, bib, inputs).
dmlr-source: dmlr dmlr-supplement
	@if grep -n 'OWNER TO CONFIRM' paper/main-dmlr.tex paper/supplement-dmlr.tex; then echo 'dmlr-source: replace every OWNER TO CONFIRM line before you package'; exit 1; fi
	cd paper && tar czf dmlr-source.tar.gz \
		main-dmlr.tex supplement-dmlr.tex refs.bib \
		dmlr/dmlr2e.sty sections figures generated \
		data/zenodo-dois.json data/suite.json data/suite.txt

dmlr-test:
	bash scripts/dmlr.test.sh

.PHONY: heatmap-test

# Figure F2 (defect class x package heatmap): regenerate the figure CSVs,
# rebuild both PDFs, and render the figure pages for review.
heatmap-test:
	bash scripts/heatmap.test.sh

.PHONY: related-test

# C9 related-work compression: rebuild both PDFs, fail on undefined
# references or citations, report the section span, print hashes.
related-test:
	bash scripts/related-compress.test.sh

.PHONY: soundness-test

# C6 grader soundness section: fresh macros and collect output, no
# typed numerals or banned prose in the section, both PDFs built twice
# with matching sha256, figure pages rendered for review.
soundness-test:
	bash scripts/grader-soundness.test.sh

.PHONY: bookkeeping-test

# C2 bookkeeping move: rebuild both PDFs, fail on undefined references
# or citations or a "??" in the extracted text, print artifact hashes.
bookkeeping-test:
	bash scripts/bookkeeping-move.test.sh

.PHONY: scatter-test

# Figure F5 (trivial score 0.1.0 vs 0.2.0): regenerate the figure CSVs,
# rebuild both PDFs, and render the figure pages for review.
scatter-test:
	bash scripts/exp/trivial-scatter.test.sh

.PHONY: hidden-audit-test

# E5 (tarball audit + hidden-split overlap): install the four
# census-qualified artifacts into a temp cache, run both E5 scripts
# twice, and diff the two CSV trees.
hidden-audit-test:
	bash scripts/exp/hidden-audit.test.sh

.PHONY: exp-macros-test

# Experiment macros: regenerate paper/generated/exp-macros.tex, prove the
# stale-output and missing-macro guards fire, rebuild both PDFs.
exp-macros-test:
	bash scripts/exp/macros.test.sh

.PHONY: reasons-test

# Figure F6 (why blind-policy rows score 0): regenerate the figure CSV,
# rebuild both PDFs, and render the figure pages for review.
reasons-test:
	bash scripts/exp/trivial-reasons-plot.test.sh

.PHONY: probe-heatmap-test

# Figure F7 (contract probes, artifact x probe): regenerate the figure
# inputs twice, rebuild both PDFs, and render the figure pages.
probe-heatmap-test:
	bash scripts/exp/probe-heatmap.test.sh

.PHONY: baselines-test

# C5 baseline section (preregistered H1 null, E1 battery, F5, F6):
# rebuild both PDFs twice, fail on undefined references or a "??",
# check float wiring and a hand-typed numeral, print artifact hashes.
baselines-test:
	bash scripts/baselines.test.sh

.PHONY: layers-test

# C3 verification-layers section and F1 redraw: rebuild both PDFs, fail
# on undefined references or a "??", check the figure label and inputs,
# fail on a hand-typed numeral in the new prose, render the figure
# pages, and build twice to prove the sha256 repeats.
layers-test:
	bash scripts/verification-layers.test.sh

.PHONY: hidden-audit-plot-test

# Figure F8 (tarball leaks + hidden/public overlap): regenerate the
# figure inputs twice, rebuild both PDFs, and render the figure pages.
hidden-audit-plot-test:
	bash scripts/exp/hidden-audit-plot.test.sh

.PHONY: exploits-plot-test

# Figure F3 (record vs re-measured dumbbell): regenerate the figure
# inputs twice, rebuild both PDFs twice, and render the figure page.
exploits-plot-test:
	bash scripts/exp/exploits-plot.test.sh

.PHONY: policy-ladder-test

# Figure F4 (the policy-tier ladder at the released versions):
# regenerate the figure inputs twice, rebuild both PDFs twice, and
# render the figure page.
policy-ladder-test:
	bash scripts/exp/policy-ladder.test.sh

.PHONY: probing-section-test

# Section 4 rewrite (taxonomy + E2 re-measurement) and the F4 ladder
# paragraph: run the generator checks, rebuild both PDFs twice, and
# render the rewritten pages.
probing-section-test:
	bash scripts/probing-section.test.sh
