#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export PP="${PAPER_PUBLISH:-$(command -v paper-publish || echo "$HOME/Documents/Personal/scripts/paper-publish")}" PKGS="benchmark-pelican benchmark-sycophancy benchmark-honesty"
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
for p in $PKGS; do node scripts/pkg-reports.mjs "$p" --out "$TMP/reports" --date 2026-10-17 >/dev/null; done

python3 - "$ROOT" "$TMP" $PKGS <<'PY'
import json, re, subprocess, sys, os
root, tmp, pkgs = sys.argv[1], sys.argv[2], sys.argv[3:]
banned = re.compile(r"\bindependent\w*\b|\b(novel|first|robust|comprehensive)\b|—", re.I)
data_files = "suite.json defects.csv review-rounds.csv council-prs.csv trivial.csv approval-defects.csv review-notes.csv zenodo-dois.json builders.csv".split()
numbers = lambda t: re.findall(r"\d+(?:\.\d+)*", t)
def unescape(ln):
    s = re.sub(r"\\allowbreak\s*", "", ln)          # a break there eats the space
    s = re.sub(r"\\\\$", "", s).replace("\\ ", " ")  # mono line end, explicit space
    s = re.sub(r"\\texttt\{((?:\\.|-\{\}-|[^{}])*)\}", r"\1", s)
    s = s.replace("-{}-{}-", "---").replace("-{}-", "--").replace("\\textasciigrave{}", "`")
    s = s.replace("\\textbackslash{}", "\x00")
    s = re.sub(r"\\([&%$#_{}])", r"\1", s)
    s = s.replace("\\textendash{}", "–").replace("\\textemdash{}", "—")
    s = s.replace("\\textellipsis{}", "…").replace("\\texttimes{}", "×")
    s = s.replace("\\textperiodcentered{}", "·").replace("\\textcopyright{}", "©")
    return s.replace("\\textasciitilde{}", "~").replace("\\textasciicircum{}", "^").replace("\x00", "\\")
def tt_spans(ln):
    return [unescape(s) for s in re.findall(r"\\texttt\{((?:\\.|-\{\}-|[^{}])*)\}", ln)]
def regions(lines):
    inside, mono, cur, regs = False, False, [], []
    for ln in lines:
        if "\\begin{quote}" in ln: inside, mono, cur = True, "ttfamily" in ln, []
        elif "\\end{quote}" in ln: inside, regs = False, regs + [(mono, cur)]
        elif inside: cur.append(ln)
    return regs
norm = lambda s: re.sub(r"\s+", " ", s).strip()
bad = []
for pkg in pkgs:
    lines = open(f"{tmp}/reports/{pkg}/report.tex").read().split("\n")
    meta = json.load(open(f"{tmp}/reports/{pkg}/meta.json"))
    union = "".join(open(f"{root}/paper/data/{f}").read() for f in data_files)
    for dp, _, fns in os.walk(f"{tmp}/reports/.cache/{pkg}"):
        union += "".join(open(os.path.join(dp, f), errors="replace").read()
                         for f in fns if f != "_fetchedAt")
    union_nums = set(numbers(union))
    prev = ""  # 1. every macro value must appear in its % source file
    for ln in lines:
        m = re.match(r"\\newcommand\{\\pkg(\w+)\}\{(.*)\}$", ln)
        sm = re.match(r"% source: (\S+)", prev) or ""
        if m:
            if not sm: bad.append(f"{pkg}: macro {m.group(1)} lacks a % source comment")
            elif not sm.group(1).startswith("generator"):
                data = open(os.path.join(root, sm.group(1))).read() if os.path.exists(os.path.join(root, sm.group(1))) else ""
                v = m.group(2)
                ok = v in data if not re.fullmatch(r"\d+(\.\d+)?", v) else v in set(numbers(data))
                if not ok: bad.append(f"{pkg}: macro {m.group(1)}={v} not in {sm.group(1)}")
        prev = ln
    in_q = False  # 2. every printed number must exist in the data union
    for ln in lines:
        if "\\begin{quote}" in ln: in_q = True; continue
        if "\\end{quote}" in ln: in_q = False; continue
        if in_q or ln.lstrip().startswith("%") or ln.startswith("\\newcommand"): continue
        if "\\begin{tabular}" in ln or "\\begin{longtable}" in ln: continue
        for n in numbers(re.sub(r"[#\\]?L\d+", "", ln)):
            if n not in union_nums:
                bad.append(f"{pkg}: unsourced number {n}: {ln.strip()[:70]}")
    qfiles = [m.group(1) for m in (re.match(r"% quote: [\w-]+/(\S+)#L\d+", l) for l in lines) if m]
    regs = regions(lines)
    if len(regs) != len(qfiles): bad.append(f"{pkg}: {len(regs)} quote blocks vs {len(qfiles)} locators")
    for (mono, reg), f in zip(regs, qfiles):
        try: srctext = open(os.path.join(tmp, "reports/.cache", pkg, f), errors="replace").read()
        except OSError: bad.append(f"{pkg}: quote source {f} not cached"); continue
        srclines = set(x.rstrip() for x in srctext.split("\n"))
        if mono:
            buf = []  # 4. a \\ -terminated run is one rendered line and must be one verbatim source line
            for l in reg:
                buf.append(l)
                if l.rstrip().endswith("\\\\"):
                    u = unescape("\n".join(buf)).replace("\n", " ")
                    if u.strip() and u.rstrip() not in srclines:
                        bad.append(f"{pkg}: code line not verbatim in {f}: {u.rstrip()[:60]}")
                    buf = []
            if any(x.strip() for x in buf):
                bad.append(f"{pkg}: code line loses its line break in {f}")
        else:
            joined = norm(unescape("\n".join(reg)))
            if joined and joined not in norm(srctext.replace("`", "")):  # 1a. quote text must match the source
                bad.append(f"{pkg}: quote text not in {f}: {joined[:60]}")
            for l in reg:  # 1b. a break hint beside a real space eats the space
                if re.search(r"\s\\allowbreak|\\allowbreak  ", l):
                    bad.append(f"{pkg}: break hint beside a space: {l.strip()[:60]}")
        for l in reg:  # 3. no backticks
            if "`" in l:
                bad.append(f"{pkg}: backtick in quote: {l.strip()[:60]}")
        regtext = "\n".join(reg)
        for flag in set(re.findall(r"--[a-zA-Z][\w-]*", unescape(regtext))):  # 2. -- flags stay monospace
            if not mono and not any(flag in s for s in tt_spans(regtext)):
                bad.append(f"{pkg}: flag {flag} outside \\texttt in {f}")
    rest, skip = [], False
    for ln in lines:
        if "\\begin{quote}" in ln: skip = "ttfamily" in ln; continue
        if "\\end{quote}" in ln: skip = False; continue
        if not skip: rest.append(ln)
    rest = re.sub(r"\\texttt\{((?:\\.|-\{\}-|[^{}])*)\}", "", "\n".join(rest))
    if re.search(r"--|-\{\}-", rest):  # 2b. no bare -- in roman text
        bad.append(f"{pkg}: bare -- outside monospace")
    in_q = False  # 4. banned wording outside quotes ("Independent researcher" is the required affiliation)
    for ln in lines:
        if "\\begin{quote}" in ln: in_q = True; continue
        if "\\end{quote}" in ln: in_q = False; continue
        if not in_q and banned.search(ln.replace("Independent researcher", "")):
            bad.append(f"{pkg}: banned wording: {ln.strip()[:70]}")
    if not 100 <= len(meta["abstract"]) <= 1920: bad.append(f"{pkg}: abstract {len(meta['abstract'])} chars")
    for k in ("title", "abstract", "comments"):
        if banned.search(str(meta.get(k, ""))): bad.append(f"{pkg}: banned wording in meta.json {k}")
    r = subprocess.run([os.environ["PP"], "check", f"{tmp}/reports/{pkg}/meta.json",
                        "--pdf", f"{tmp}/reports/{pkg}/report.pdf"], capture_output=True, text=True)
    if r.returncode: bad.append(f"{pkg}: paper-publish check: {r.stderr.strip()[-160:]}")
if bad:
    print("\n".join("FAIL: " + b for b in bad), file=sys.stderr); sys.exit(1)
PY
for p in $PKGS; do sha256sum "$TMP/reports/$p/report.tex"; done
echo "pkg-reports e2e: 3 reports generated, all checks passed -> ok"
