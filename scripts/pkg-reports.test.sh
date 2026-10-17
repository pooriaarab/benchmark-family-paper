#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export PP="${PAPER_PUBLISH:-$(command -v paper-publish || echo "$HOME/Documents/Personal/scripts/paper-publish")}" PKGS="benchmark-pelican benchmark-sycophancy benchmark-honesty"
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
LINKS=""
for a in "$@"; do [ "$a" = "--links" ] && LINKS=1; [ "$a" = "--no-links" ] && LINKS=0; done
[ -n "$LINKS" ] || LINKS=$(curl -sfI -o /dev/null --max-time 5 https://api.github.com && echo 1 || echo 0)
export LINKS
if [ ! -x "$PP" ]; then
  echo "pkg-reports.test.sh: paper-publish not found at '$PP'" >&2
  echo "expected an executable at \$HOME/Documents/Personal/scripts/paper-publish or set PAPER_PUBLISH" >&2
  exit 2
fi
node scripts/pkg-reports.mjs all --out "$TMP/reports" --date 2026-10-17 >/dev/null

python3 - "$ROOT" "$TMP" $PKGS <<'PY'
import json, math, re, subprocess, sys, os
root, tmp, pkgs = sys.argv[1], sys.argv[2], sys.argv[3:]
banned = re.compile(r"(?<![\w-])(?:independent\w*|novel|first|robust|comprehensive)(?![\w-])|—", re.I)
slogan = re.compile(r",\s*not\s|\bnot of\b|council-reviewed pull", re.I)
data_files = "suite.json defects.csv review-rounds.csv council-prs.csv trivial.csv approval-defects.csv review-notes.csv zenodo-dois.json builders.csv".split()
numbers = lambda t: re.findall(r"\d+(?:\.\d+)*", t); norm = lambda s: re.sub(r"\s+", " ", s).strip()
suite = json.load(open(f"{root}/paper/data/suite.json"))
mock_seeds = set(re.findall(r'"--seed",\s*"(\d+)"', open(f"{root}/scripts/collect.mjs").read()))
def unescape(ln):
    s = re.sub(r"\\hspace\*?\{([\d.]+)em\}", lambda m: " " * round(float(m.group(1)) / 0.5), ln)
    s = re.sub(r"\\allowbreak\s*", "", s)          # a break there eats the space
    s = re.sub(r"\\\\$", "", s).replace("\\ ", " ")  # mono line end, explicit space
    s = re.sub(r"\\textbf\{((?:\\.|-\{\}-|[^{}])*)\}", r"\1", s)
    s = re.sub(r"\\href\{[^{}]*\}\{((?:\\.|-\{\}-|[^{}])*)\}", r"\1", s)
    s = re.sub(r"\\texttt\{((?:\\.|-\{\}-|[^{}])*)\}", r"\1", s)
    s = s.replace("-{}-{}-", "---").replace("-{}-", "--").replace("\\textasciigrave{}", "`")
    s = s.replace("\\textbackslash{}", "\x00").replace("~", " ")
    s = re.sub(r"\\([&%$#_{}])", r"\1", s)
    s = s.replace("\\textendash{}", "–").replace("\\textemdash{}", "—")
    s = s.replace("\\textellipsis{}", "…").replace("\\texttimes{}", "×").replace("\\textperiodcentered{}", "·").replace("\\textcopyright{}", "©")
    return s.replace("\\textasciitilde{}", "~").replace("\\textasciicircum{}", "^").replace("\x00", "\\")
unmd = lambda s: re.sub(r"(?m)^\s*(?:[-*+]|\d+[.)])\s+", "", re.sub(r"\[([^\]]*)\]\(([^)]*)\)", r"\1", s.replace("**", "")))
def gw(s):  # width in rendered typewriter glyphs (mirrors the generator's atomW)
    w = 0
    for a in re.findall(r"\\hspace\*?\{[\d.]+em\}|\\[a-zA-Z]+\{\}?|\\.|-\{\}-|.", s.rstrip()):
        h = re.fullmatch(r"\\hspace\*?\{([\d.]+)em\}", a)
        w += math.ceil(float(h.group(1)) / 0.5) if h else 2 if a == "-{}-" else 1
    return w
tt_spans = lambda ln: [unescape(s) for s in re.findall(r"\\texttt\{((?:\\.|-\{\}-|[^{}])*)\}", ln)]
def regions(lines):
    inside, mono, cur, regs = False, False, [], []
    for ln in lines:
        if "\\begin{quote}" in ln: inside, mono, cur = True, "ttfamily" in ln, []
        elif "\\end{quote}" in ln: inside, regs = False, regs + [(mono, cur)]
        elif inside: cur.append(ln)
    return regs
bad = []
for pkg in pkgs:
    lines = open(f"{tmp}/reports/{pkg}/report.tex").read().split("\n")
    meta = json.load(open(f"{tmp}/reports/{pkg}/meta.json"))
    union = "".join(open(f"{root}/paper/data/{f}").read() for f in data_files)
    for dp, _, fns in os.walk(f"{tmp}/reports/.cache/{pkg}"):
        union += "".join(open(os.path.join(dp, f), errors="replace").read() for f in fns if f != "_fetchedAt")
    union_nums = set(numbers(union)); prev = ""  # 1. every macro value must appear in its % source file
    for ln in lines:
        m, sm = re.match(r"\\newcommand\{\\pkg(\w+)\}\{(.*)\}$", ln), re.match(r"% source: (\S+)", prev) or ""
        if m:
            if not sm: bad.append(f"{pkg}: macro {m.group(1)} lacks a % source comment")
            elif not sm.group(1).startswith("generator"):
                data = open(os.path.join(root, sm.group(1))).read() if os.path.exists(os.path.join(root, sm.group(1))) else ""
                v = m.group(2)
                if not (v in data if not re.fullmatch(r"\d+(\.\d+)?", v) else v in set(numbers(data))): bad.append(f"{pkg}: macro {m.group(1)}={v} not in {sm.group(1)}")
        prev = ln
    in_q = False  # 2. every printed number must exist in the data union
    for ln in lines:
        if "\\begin{quote}" in ln: in_q = True; continue
        if "\\end{quote}" in ln: in_q = False; continue
        if in_q or ln.lstrip().startswith("%") or ln.startswith("\\newcommand") or "\\begin{tabular}" in ln or "\\begin{longtable}" in ln: continue
        for n in numbers(re.sub(r"[#\\]?L\d+", "", ln)):
            if n not in union_nums: bad.append(f"{pkg}: unsourced number {n}: {ln.strip()[:70]}")
    qfiles = [m.group(1) for m in (re.match(r"% quote: [\w-]+/(\S+)#L\d+", l) for l in lines) if m]
    regs = regions(lines); srclines = None
    if len(regs) != len(qfiles): bad.append(f"{pkg}: {len(regs)} quote blocks vs {len(qfiles)} locators")
    for (mono, reg), f in zip(regs, qfiles):
        try: srctext = open(os.path.join(tmp, "reports/.cache", pkg, f), errors="replace").read()
        except OSError: bad.append(f"{pkg}: quote source {f} not cached"); continue
        srclines = set(x.rstrip() for x in srctext.split("\n"))
        if mono:
            if any(not l.rstrip().endswith("\\\\") for l in reg):  # 4a. every code row keeps its line break
                bad.append(f"{pkg}: code line loses its line break in {f}")
            for l in reg:  # 4c. no printed code row runs past the 62-glyph quote measure
                if gw(re.sub(r"\\\\\s*$", "", l)) > 62: bad.append(f"{pkg}: code row wider than the measure in {f}: {l.strip()[:60]}")
            logical = []  # 4b. a hookarrow-marked row continues the previous rendered line
            for l in reg:
                cont = bool(re.match(r"\s*\$\\hookrightarrow\$", l)) and bool(logical)
                u = unescape(re.sub(r"^\s*\$\\hookrightarrow\$\s*(\\hspace\*?\{[\d.]+em\})?\s*", "", l) if cont else l)
                if cont: logical[-1] += u
                else: logical.append(u)
            for u in logical:  # each reconstructed line must be one verbatim source line
                u = u.rstrip()
                if u.strip() and u not in srclines: bad.append(f"{pkg}: code line not verbatim in {f}: {u[:60]}")
        else:
            joined = norm(unescape("\n".join(reg)))
            if joined and joined not in norm(unmd(srctext.replace("`", ""))):  # 1a. quote text must match the source
                bad.append(f"{pkg}: quote text not in {f}: {joined[:60]}")
            for l in reg:  # 1b. a break hint beside a real space eats the space
                if re.search(r"\s\\allowbreak|\\allowbreak  ", l):
                    bad.append(f"{pkg}: break hint beside a space: {l.strip()[:60]}")
        for l in reg:  # 3. no backticks
            if "`" in l: bad.append(f"{pkg}: backtick in quote: {l.strip()[:60]}")
        for flag in set(re.findall(r"--[a-zA-Z][\w-]*", unescape("\n".join(reg)))):  # 2. -- flags stay monospace
            if not mono and not any(flag in s for s in tt_spans("\n".join(reg))):
                bad.append(f"{pkg}: flag {flag} outside \\texttt in {f}")
    rest, skip = [], False
    for ln in lines:
        if "\\begin{quote}" in ln: skip = "ttfamily" in ln; continue
        if "\\end{quote}" in ln: skip = False; continue
        if not skip: rest.append(ln)
    if re.search(r"--|-\{\}-", re.sub(r"\\texttt\{((?:\\.|-\{\}-|[^{}])*)\}", "", "\n".join(rest))):  # 2b. no bare -- in roman text
        bad.append(f"{pkg}: bare -- outside monospace")
    for m in re.finditer(r"\\(?:href|url)\{((?:\\.|\{\}|[^{}])*)\}", "\n".join(lines)):  # 6. every link address is one absolute token
        a = m.group(1)  # hyperref prints \# \% \_ \& as the plain char; any other escape still fails
        addr = re.sub(r"\\([&%$#_{}])", r"\1", a)
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", addr) or re.search(r"[\s\\]", addr):
            bad.append(f"{pkg}: link address not one absolute URL token: {a[:60]}")
    macrov = {m.group(1): m.group(2) for m in (re.match(r"\\newcommand\{\\pkg(\w+)\}\{(.*)\}", l) for l in lines) if m}
    pub = {str(x) for p in suite["packages"] if p["id"] == pkg for x in p.get("publicSeeds") or []}
    def seed_check(text, resolve, where):  # 5. every seed named keeps the role its source gives it
        for seg in re.split(r"[.;:()]", text):  # the role word must lead the seed inside its segment
            for m in re.finditer(r"\bseeds?\s*-?\s*(?:at\s+|of\s+)?((?:\\pkg\w+\{\}|\d+)(?:\s*(?:,|and)\s*(?:\\pkg\w+\{\}|\d+))*)", seg):
                bare = re.sub(r"\\pkg\w+\{\}", "", seg[: m.start()])  # role words come from prose, never a macro name
                for mac, num in re.findall(r"\\pkg(\w+)\{\}|(\d+)", m.group(1)):
                    for n in numbers(num or resolve.get(mac, "")):
                        if n in pub:
                            if not re.search(r"split|generat", bare, re.I):
                                bad.append(f"{pkg}: public-split seed {n} outside a split role ({where}): {seg.strip()[:60]}")
                        elif n in mock_seeds:
                            if "mock" not in bare.lower():
                                bad.append(f"{pkg}: mock seed {n} outside a mock role ({where}): {seg.strip()[:60]}")
                        else: bad.append(f"{pkg}: seed {n} not a collect.mjs mock seed or suite publicSeed ({where}): {seg.strip()[:60]}")
    paras, buf, in_q = [], [], False  # join each paragraph so a line break cannot hide a seed
    for ln in lines:
        if "\\begin{quote}" in ln or "\\end{quote}" in ln or re.match(r"\\(section|subsection|begin|end|caption|label|noindent)\b", ln):
            if buf: paras.append(" ".join(buf)); buf = []
            in_q = in_q or "\\begin{quote}" in ln
            if "\\end{quote}" in ln: in_q = False
            continue
        if in_q or ln.lstrip().startswith("%") or ln.startswith("\\newcommand"): continue
        if not ln.strip():
            if buf: paras.append(" ".join(buf)); buf = []
        else: buf.append(ln.strip())
    if buf: paras.append(" ".join(buf))
    in_q = False  # 4. banned wording outside quotes ("Independent researcher" is the required affiliation)
    for ln in lines:
        if "\\begin{quote}" in ln: in_q = True; continue
        if "\\end{quote}" in ln: in_q = False; continue
        if in_q: continue
        if banned.search(ln.replace("Independent researcher", "")): bad.append(f"{pkg}: banned wording: {ln.strip()[:70]}")
        if not ln.lstrip().startswith("%") and slogan.search(ln): bad.append(f"{pkg}: 'X, not Y' or overclaimed label: {ln.strip()[:70]}")
    for para in paras: seed_check(para, macrov, "report.tex")
    seed_check(meta.get("abstract", ""), {}, "meta.json")
    if not 100 <= len(meta["abstract"]) <= 1920: bad.append(f"{pkg}: abstract {len(meta['abstract'])} chars")
    for k in ("title", "abstract", "comments"):
        if banned.search(str(meta.get(k, ""))) or slogan.search(str(meta.get(k, ""))): bad.append(f"{pkg}: banned wording in meta.json {k}")
    for f in ("report.tex", "meta.json"):  # a committed report must equal the regenerated file
        have = os.path.join(root, "reports", pkg, f)
        if os.path.exists(have) and open(have, "rb").read() != open(f"{tmp}/reports/{pkg}/{f}", "rb").read():
            bad.append(f"{pkg}: committed reports/{pkg}/{f} differs from regenerated output")
    if os.environ.get("LINKS") == "1":  # link check on: every link target must resolve (needs the network)
        for u in sorted(set(re.findall(r"\\(?:href|url)\{((?:\\.|\{\}|[^{}])*)\}", "\n".join(lines)))):
            u = re.sub(r"\\([&%$#_{}])", r"\1", u)  # curl the unescaped address
            c = subprocess.run(["curl", "-sI", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "15", u], capture_output=True, text=True).stdout.strip()
            if c != "200": bad.append(f"{pkg}: link {u} -> HTTP {c or 'timeout'}")
    r = subprocess.run([os.environ["PP"], "check", f"{tmp}/reports/{pkg}/meta.json", "--pdf", f"{tmp}/reports/{pkg}/report.pdf"], capture_output=True, text=True)
    if r.returncode: bad.append(f"{pkg}: paper-publish check: {r.stderr.strip()[-160:]}")
for d in sorted(os.listdir(f"{tmp}/reports")):  # 7. every generated report builds inside the measure
    ddir = f"{tmp}/reports/{d}"
    if d == ".cache" or not os.path.isdir(ddir): continue
    r = subprocess.run([os.environ.get("TECTONIC") or "tectonic", "--keep-logs", "report.tex"], cwd=ddir, capture_output=True, text=True)
    if r.returncode: bad.append(f"{d}: tectonic rebuild failed: {r.stderr.strip()[-120:]}"); continue
    for m in re.finditer(r"Overfull \\hbox \(([\d.]+)pt too wide\)[^\n]*", open(f"{ddir}/report.log", errors="replace").read()):
        if float(m.group(1)) > 1.0: bad.append(f"{d}: {m.group(0).strip()}")
if bad:
    print("\n".join("FAIL: " + b for b in bad), file=sys.stderr); sys.exit(1)
PY
for p in $PKGS; do sha256sum "$TMP/reports/$p/report.tex"; done
echo "pkg-reports e2e: all reports generated, all checks passed -> ok"
