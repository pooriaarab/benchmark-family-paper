#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export PP="${PAPER_PUBLISH:-$(command -v paper-publish || echo "$HOME/Documents/Personal/scripts/paper-publish")}"
PKGS="benchmark-pelican benchmark-sycophancy benchmark-honesty"
for p in $PKGS; do
  node scripts/pkg-reports.mjs "$p" --out "$TMP/reports" --date 2026-10-17 >/dev/null
done

python3 - "$ROOT" "$TMP" $PKGS <<'PY'
import json, re, subprocess, sys, os
root, tmp, pkgs = sys.argv[1], sys.argv[2], sys.argv[3:]
banned = re.compile(r"\bindependent\w*\b|\b(novel|first|robust|comprehensive)\b|—", re.I)
data_files = ["suite.json", "defects.csv", "review-rounds.csv", "council-prs.csv",
              "trivial.csv", "approval-defects.csv", "review-notes.csv",
              "zenodo-dois.json", "builders.csv"]
numbers = lambda t: re.findall(r"\d+(?:\.\d+)*", t)
def unescape(ln):
    s = ln.replace("\\allowbreak ", "").replace("\\allowbreak", "")
    s = s.replace("\\textbackslash{}", "\x00")
    s = re.sub(r"\\([&%$#_{}])", r"\1", s)
    return s.replace("\\textasciitilde{}", "~").replace("\\textasciicircum{}", "^").replace("\x00", "\\")
def regions(lines):
    inside, cur, regs = False, [], []
    for ln in lines:
        if "\\begin{quote}" in ln: inside, cur = True, []
        elif "\\end{quote}" in ln: inside, regs = False, regs + [cur]
        elif inside: cur.append(ln)
    return regs
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
    for reg, f in zip(regs, qfiles):
        try: srclines = set(x.rstrip() for x in open(os.path.join(tmp, "reports/.cache", pkg, f), errors="replace"))
        except OSError: bad.append(f"{pkg}: quote source {f} not cached"); continue
        for l in reg:
            if l.strip() and unescape(l).strip() not in srclines:
                bad.append(f"{pkg}: quote not verbatim in {f}: {l.strip()[:60]}")
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
