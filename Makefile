# Build the benchmark-family paper.
# Tested with Tectonic 0.17.0 (x86_64-unknown-linux-gnu).

TECTONIC ?= tectonic

.PHONY: collect pdf arxiv release-assets clean

collect:
	node scripts/collect.mjs

pdf:
	cd paper && $(TECTONIC) main.tex

arxiv:
	node scripts/arxiv.mjs

release-assets:
	@echo "$(CURDIR)/paper/main.pdf"
	@echo "$(CURDIR)/arxiv/benchmark-family-arxiv.tar.gz"

clean:
	rm -f paper/main.pdf paper/main.aux paper/main.log paper/main.bbl \
		paper/main.blg paper/main.out paper/main.toc
