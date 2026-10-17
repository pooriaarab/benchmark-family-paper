# Build the benchmark-family paper.
# Tested with Tectonic 0.17.0 (x86_64-unknown-linux-gnu).
# The NeurIPS style is fetched, never committed: scripts/fetch-style.mjs
# downloads the official zip, pins its SHA-256, and extracts the .sty.

TECTONIC ?= tectonic
export TECTONIC

.PHONY: collect pdf arxiv release-assets clean style

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

.PHONY: layers-test

# C3 verification-layers section and F1 redraw: rebuild both PDFs, fail
# on undefined references or a "??", check the figure label and inputs,
# fail on a hand-typed numeral in the new prose, render the figure
# pages, and build twice to prove the sha256 repeats.
layers-test:
	bash scripts/verification-layers.test.sh
