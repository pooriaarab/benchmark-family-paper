#!/usr/bin/env bash
# End-to-end check for the round-4 facts pass (issue #225): the probe
# cell split, the seed hand-check, the weak post-fix holds, the
# repaired T3 reference, the claim-table rows, CITATION.cff, the COI
# sentence, and both PDFs built twice with identical sha256.
# See scripts/r4-facts.failure-modes.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

MAIN=paper/main.tex
DMLR=paper/main-dmlr.tex
S4=paper/sections/adversarial.tex
GS=paper/sections/grader-soundness.tex
PRE=paper/sections/prereg.tex
CLO=paper/sections/closing.tex
CON=paper/sections/conclusion.tex
INT=paper/sections/intro.tex
TOUCHED="$MAIN $DMLR $S4 $GS $PRE $CLO $CON $INT paper/figures/fig-hidden-audit.tex"

echo "== generated inputs are fresh"
node scripts/exp/macros.mjs --check
cp -r paper/generated "$OUT/generated.before"
node scripts/collect.mjs > "$OUT/collect.log" 2>&1 \
  || { tail -20 "$OUT/collect.log"; exit 1; }
git checkout -- paper/data/suite.json
diff -r "$OUT/generated.before" paper/generated \
  || { echo "collect.mjs moved generated files"; exit 1; }

echo "== no control character in any generated tex"
if grep -rlP '[\x00-\x08\x0b-\x1f\x7f]' paper/generated/*.tex | grep .; then
  echo "control character above"; exit 1
fi

echo "== the broken reference is repaired and T3 splits the weak holds"
grep -qF 'Table~\ref{tab:exploit-verdicts-low}' paper/generated/exploit-verdicts.tex \
  || { echo "T3 caption reference still broken"; exit 1; }
if grep -c 'eftab' paper/generated/*.tex | grep -v ':0'; then
  echo "eftab corruption survived"; exit 1
fi
grep -qF 'of which weak' paper/generated/exploit-verdicts.tex \
  || { echo "T3 lost the weak column"; exit 1; }

echo "== the recomputed counts match the macros"
macro() { sed -nE "s/.*\\\\$1\\}\\{([^{}]*)\\}.*/\\1/p" paper/generated/exp-macros.tex | head -1; }
typeA=$(python3 - <<'PY'
import csv, json
vers = json.load(open('scripts/exp/versions.json'))
rel = {}
for a in vers['artifacts']:
    rel[a['name']] = max((x['version'] for x in vers['artifacts'] if x['name']==a['name']), key=lambda s:[int(p) for p in s.split('.')])
types = {p['id']: p.get('type') for p in json.load(open('scripts/exp/probes.json'))['probes']}
cells = pkgs = 0; pkgset = set()
for r in csv.DictReader(open('paper/data/exp/contract-probes.csv')):
    if r['result'] == 'fail' and r['version'] == rel[r['package']] and types.get(r['probe']) == 'A':
        cells += 1; pkgset.add(r['package'])
print(f"{cells} {len(pkgset)}")
PY
)
set -- $typeA
[ "$1" = "$(macro expProbesCreditFailCells)" ] || { echo "type-A cells $1 != macro"; exit 1; }
[ "$2" = "$(macro expProbesCreditFailPkgCount)" ] || { echo "type-A pkgs $2 != macro"; exit 1; }
seeds=$(awk -F, 'NR>1 && $4=="detector" && $5=="seed"' paper/data/exp/seed-check.csv | cut -d, -f3 | sort -u | wc -l)
[ "$seeds" = "$(macro expAuditSeedRealDistinct)" ] || { echo "detector seeds $seeds != macro"; exit 1; }
total=$(awk -F, 'NR>1 && $5=="seed"' paper/data/exp/seed-check.csv | cut -d, -f3 | sort -u | wc -l)
[ "$total" = "$(macro expAuditSeedTotalDistinct)" ] || { echo "total seeds $total != macro"; exit 1; }
weak=$(python3 - <<'PY'
import csv
n = 0
for part in 'ab':
    for r in csv.DictReader(open(f'paper/data/exp/exploit-results-{part}.csv')):
        if r['verdict'] == 'fix-holds' and 'below 0.1.0' in r['clause']:
            n += 1
print(n)
PY
)
[ "$weak" = "$(macro expExplFixHoldsWeak)" ] || { echo "weak holds $weak != macro"; exit 1; }

echo "== the corrected claims are in place"
grep -q 'cases of the title are the packages' "$MAIN" || { echo "abstract lacks the cases clause"; exit 1; }
grep -q 'expProbesCreditFailCells' "$MAIN" || { echo "abstract lacks the credit-fail count"; exit 1; }
grep -q 'expExplFixHoldsWeak' "$MAIN" || { echo "abstract lacks the weak holds"; exit 1; }
grep -q 'approval-to-defect cases' "$MAIN" || { echo "abstract lacks the approval count"; exit 1; }
grep -q 'safe and useful' "$S4" || { echo "S4 lacks the r21 residual verdict"; exit 1; }
grep -q 'designed or chance credit' "$PRE" || { echo "S5 lacks the credit split"; exit 1; }
grep -q 'strict grader' "$GS" || { echo "S6 lacks the strictness bucket"; exit 1; }
grep -q 'caught the logged defects in' "$CLO" || { echo "claim table blind row stale"; exit 1; }
grep -q 'regenerated splits still overlap' "$CLO" || { echo "claim table hidden row stale"; exit 1; }
grep -q 'received no funding' "$CLO" || { echo "COI sentence missing"; exit 1; }

echo "== CITATION.cff carries ORCID and the concept DOI"
python3 - <<'PY'
import yaml
d = yaml.safe_load(open('CITATION.cff'))
assert d['authors'][0]['orcid'].endswith('0009-0005-9964-6841')
assert d['doi'] == '10.5281/zenodo.23428801'
pc = d['preferred-citation']
assert pc['doi'] == '10.5281/zenodo.23428801' and pc.get('year') and pc.get('url')
print('cff ok')
PY

echo "== no typed numerals in the touched prose"
for f in $GS $PRE $S4 $CLO $CON $INT; do
  leftover=$(sed 's/%.*//' "$f" \
    | sed 's/\\texttt{[^{}]*}//g; s/\\allowbreak//g; s/\\emph{[^{}]*}//g; s/\\cite{[^{}]*}//g; s/p{[0-9.]*\\textwidth}//g' \
    | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}//g; s/[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*//g; s/0\.[12]\.0//g; s/\b[HEFDLT][0-9]\{1,2\}b\{0,1\}\b//g; s/wave[- ][0-9]//g; s/\br[0-9]\{1,2\}\b//g' \
    | grep -oE '[0-9]+' || true)
  [ -z "$leftover" ] || { echo "$f: typed numeral $leftover"; exit 1; }
done

echo "== style guard on the touched files"
if grep -nP '[\x{2013}\x{2014}]|---' $TOUCHED; then
  echo "em/en dash found above"; exit 1
fi
if grep -inE '\b(novel|robust|comprehensive)\b' $TOUCHED; then
  echo "banned word found above"; exit 1
fi
if grep -inE '\bindependent\b' $TOUCHED | grep -vi 'independent researcher'; then
  echo "independent used outside the affiliation"; exit 1
fi
if grep -nF ', not ' $TOUCHED; then
  echo "'X, not Y' slogan shape above"; exit 1
fi

echo "== build both PDFs twice with a fixed epoch"
export SOURCE_DATE_EPOCH=1729000000
build_round() {
  for target in pdf dmlr; do
    make "$target" > "$OUT/$1-$target.log" 2>&1 \
      || { tail -20 "$OUT/$1-$target.log"; exit 1; }
    if grep -iE 'undefined|citation.*undefined|overfull|Float too large' \
        "$OUT/$1-$target.log"; then
      echo "make $target ($1): undefined refs, overfull or float too large above"
      exit 1
    fi
  done
  for f in paper/main.pdf paper/main-dmlr.pdf; do
    if grep -F '??' <<< "$(pdftotext "$f" - 2>/dev/null)" \
        | grep -vqF '?? "'; then
      echo "$f ($1): extracted text contains ??"; exit 1
    fi
  done
  sha256sum paper/main.pdf paper/main-dmlr.pdf
}
build_round first | tee "$OUT/hashes.first"
rm -f paper/main.pdf paper/main-dmlr.pdf
build_round second | tee "$OUT/hashes.second"
diff "$OUT/hashes.first" "$OUT/hashes.second" \
  || { echo 'PDF hashes differ between the two builds'; exit 1; }

echo "== the repaired reference resolves in the built text"
if pdftotext paper/main.pdf - | grep -n 'eftab'; then
  echo "eftab still prints"; exit 1
fi

echo "== dmlr clean-checkout check"
bash scripts/dmlr.test.sh

echo "facts: counts checked, both builds clean -> r4-facts, ok"
