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
	node scripts/arxiv.mjs

release-assets:
	@echo "$(CURDIR)/paper/main.pdf"
	@echo "$(CURDIR)/arxiv/benchmark-family-arxiv.tar.gz"

clean:
	rm -f paper/main.pdf paper/main.aux paper/main.log paper/main.bbl \
		paper/main.blg paper/main.out paper/main.toc paper/neurips_2026.sty
