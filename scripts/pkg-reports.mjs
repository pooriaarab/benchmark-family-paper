#!/usr/bin/env node
// One technical report per package from the family data. Usage:
// node scripts/pkg-reports.mjs <pkg|all> [--refresh] [--out DIR] [--date YYYY-MM-DD].
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const flagVals = new Set([flag("--out"), flag("--date")]);
const target = args.find((a) => !a.startsWith("--") && !flagVals.has(a));
const OUT = flag("--out") || join(root, "reports");
const DATE = flag("--date") || process.env.PKG_REPORT_DATE || new Date().toISOString().slice(0, 10);
const REFRESH = args.includes("--refresh");
const fail = (m) => { console.error(`pkg-reports: ${m}`); process.exit(1); };
function readCsv(path) {
  const rows = [], text = readFileSync(path, "utf8"); let f = "", row = [], q = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || i === text.length) { row.push(f); f = ""; if (row.length > 1 || row[0]) rows.push(row); row = []; }
    else if (c !== "\r") f += c;
  }
  const head = rows.shift(); return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const cacheDir = (pkg) => join(OUT, ".cache", pkg), ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const ghHeaders = () => (ghToken ? { authorization: `Bearer ${ghToken}` } : {});
async function fetchFile(pkg, path, ref) {
  const file = join(cacheDir(pkg), path); mkdirSync(dirname(file), { recursive: true });
  if (!REFRESH && existsSync(file)) return;
  const url = `https://raw.githubusercontent.com/pooriaarab/${pkg}/${ref}/${path}`;
  const res = await fetch(url, { redirect: "follow", headers: ghHeaders() });
  if (res.status !== 200) fail(`GET ${url} returned HTTP ${res.status}`); writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
// Sources pin to the released tag so a blob link shows the measured
// text after main moves on; a cache without the ref stamp is dropped.
async function cachePackage(pkg, ref) {
  const stamp = join(cacheDir(pkg), "_ref");
  if (existsSync(cacheDir(pkg)) && (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== ref)) rmSync(cacheDir(pkg), { recursive: true, force: true });
  for (const p of ["README.md", "CHANGELOG.md", "package.json"]) await fetchFile(pkg, p, ref);
  const turl = `https://api.github.com/repos/pooriaarab/${pkg}/git/trees/${ref}?recursive=1`;
  const res = await fetch(turl, { headers: ghHeaders() }); if (res.status !== 200) fail(`GET ${turl} returned HTTP ${res.status}`);
  for (const n of JSON.parse(await res.text()).tree || [])
    if (n.type === "blob" && n.path.startsWith("docs/")) await fetchFile(pkg, n.path, ref);
  writeFileSync(stamp, ref + "\n"); writeFileSync(join(cacheDir(pkg), "_fetchedAt"), new Date().toISOString() + "\n");
}
function cachedLines(pkg, path) {
  const file = join(cacheDir(pkg), path); if (!existsSync(file)) fail(`${pkg}: ${path} not in ${cacheDir(pkg)}`);
  return readFileSync(file, "utf8").split("\n");
}
// Quotes keep a source em dash (tex escapes it; the gate skips quote
// regions); the five-word ban reads whole words, so cancel-first passes.
const BANNED = /(?<![\w-])(independent\w*|novel|first|robust|comprehensive)(?![\w-])/i;
function pickLine(lines, test, label) {
  for (let i = 0; i < lines.length; i++) { const t = lines[i].trim();
    if (test(t) && !BANNED.test(t)) return { lines: [t], line: i + 1 }; }
  fail(label);
}
// A README wrapped at 80 columns splits one paragraph over many lines;
// join the continuation lines or the quote ends mid-sentence. The join
// stops at a blank line, a heading, a fence, a table row, a blockquote
// or a new list item, so a one-line pick keeps its old output.
const PARA_STOP = /^\s*(?:#|```|\||>|[-*+]\s|\d+[.)]\s)/;
function joinPara(lines, it) {
  for (let i = it.line; i < lines.length && lines[i].trim() && !PARA_STOP.test(lines[i]); i++) it.lines.push(lines[i].trim());
  return it;
}
const questionLine = (ls) => joinPara(ls, pickLine(ls, (t) => t && !"#[`|".includes(t[0]) && /(\bmeasures\b|\basks\b|\bis an open-source\b)/.test(t), "README has no question line"));
// Join each changelog paragraph and quote the one sentence carrying the
// comparability phrase; a changelog without one returns null.
const COMPARE_RE = /not comparable|cannot be compared/i;
function changelogQuote(ls) {
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].trim();
    if (!t || t.startsWith("#") || t.startsWith("```")) continue;
    const para = [t], start = i + 1;
    while (i + 1 < ls.length && ls[i + 1].trim() && !ls[i + 1].trim().startsWith("#") && !ls[i + 1].trim().startsWith("```")) para.push(ls[++i].trim());
    const joined = para.join(" "); if (!COMPARE_RE.test(joined)) continue;
    for (const s of joined.split(/(?<=\.)\s+/))
      if (COMPARE_RE.test(s) && !BANNED.test(s)) return { lines: [s], line: start };
  }
  return null;
}
// A grading paragraph that ends with a colon may introduce a fenced block;
// return both so the quote does not stop before the example it announces.
function gradingQuote(lines) {
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith("#")) continue;
    const para = [t], start = i + 1;
    while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].trim().startsWith("```")) para.push(lines[++i].trim());
    if (BANNED.test(para.join(" "))) continue;
    const out = { para: { lines: para, line: start } }; let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (para[para.length - 1].endsWith(":") && j < lines.length && lines[j].trim().startsWith("```")) {
      const code = [], cs = j + 2;
      for (j = j + 1; j < lines.length && !lines[j].trim().startsWith("```"); j++) code.push(lines[j].trimEnd()); out.code = { lines: code, line: cs };
    }
    return out;
  }
  fail("docs/grading.md has no usable grading paragraph");
}
const SURFACES = (pkg) => [
  ["TypeScript SDK", (t) => t.startsWith("import") && t.includes(`"${pkg}"`)],
  ["Command-line interface", (t) => t.includes(`npx ${pkg} run`)],
  ["Model Context Protocol server", (t) => t.includes(`npx ${pkg} mcp`)],
  ["Fetch-style HTTP API", (t) => /`handler`|Routes are|Routes:/.test(t)],
];
const surfaceRows = (pkg, lines) => SURFACES(pkg).map(([name, test]) => ({ name, ...pickLine(lines, test, `README shows no ${name} surface`) }));
// A surface line that ends with a colon introduces a fenced block to quote.
function fenceAfter(lines, it) {
  if (!it.lines[it.lines.length - 1].endsWith(":")) return null;
  let j = it.line; while (j < lines.length && !lines[j].trim()) j++;
  if (j >= lines.length || !lines[j].trim().startsWith("```")) return null;
  const code = [], cs = j + 2;
  for (j = j + 1; j < lines.length && !lines[j].trim().startsWith("```"); j++) code.push(lines[j].trimEnd());
  return { lines: code, line: cs };
}
const isCmd = (t) => /^(import|export|npm|npx|node|bunx?|pnpm|yarn|curl|git|GET|POST|PUT|DELETE)\b/.test(t);
// Offline quotes keep install and mock-run lines only; a fenced block naming
// --provider openrouter is a paid run quoted under its own lead-in.
function commandQuotes(lines) {
  const off = [], paid = [], seen = new Set();
  for (let i = 0, fence = null; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("```")) {
      if (fence && /--provider\s+openrouter\b/.test(fence.lines.join("\n"))) paid.push(fence);
      fence = fence ? null : { lines: [], line: i + 2 };
      continue;
    }
    if (fence) fence.lines.push(lines[i].trimEnd());
    if ((/^npm install /.test(t) || /^npx \S+ run\b.*--provider\s+mock\b/.test(t)) && !seen.has(t)) { seen.add(t); off.push({ lines: [t], line: i + 1 }); }
  }
  if (!off.length) fail("README has no install/mock command lines");
  return { off, paid };
}
function sampleQuote(lines, pkg) {
  for (let i = 0, inFence = false, wantFence = false; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (!t.startsWith("```")) { if (new RegExp(`npx ${pkg} run\\b.*--provider\\s+mock\\b`).test(t)) wantFence = true; continue; }
    if (wantFence && !inFence) {
      const block = [], start = i + 2;
      for (i = i + 1; i < lines.length && !lines[i].startsWith("```"); i++) block.push(lines[i].trimEnd());
      i--;
      if (block.some((l) => /mean|Score|score/.test(l))) return { lines: block.slice(0, 12), line: start };
    } else inFence = !inFence;
  }
  fail("README has no sample-run block");
}
function sectionLine(lines, headingRe) {
  const start = lines.findIndex((l) => headingRe.test(l)); if (start < 0) return null; let fence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("```")) { fence = !fence; continue; }
    if (t.startsWith("#") && !fence) break;
    if (t && !fence && !t.startsWith("|") && !BANNED.test(t)) return joinPara(lines, { lines: [t], line: i + 1 });
  }
  return null;
}
// First README section admitting limits, scope, caveats or what-it-does-not; absence is stated.
const LIMITS_RE = /^## .*?\b(limits?|limitations|scope|caveats?|what it does not)\b/i;
// Any ## or ### heading about data, provenance or reproduction counts.
const PROV_RE = /^#{2,3}\s.*\b(data|provenance|reproduc\w*)\b/i;
// \x00 keeps a source backslash apart from the braces the escapes below
// insert; escaping { } after \ would re-escape \textbackslash{} itself.
const tex = (v) => String(v)
  .replaceAll("\\", "\x00").replaceAll("&", "\\&").replaceAll("%", "\\%")
  .replaceAll("$", "\\$").replaceAll("#", "\\#").replaceAll("_", "\\_")
  .replaceAll("{", "\\{").replaceAll("}", "\\}")
  .replaceAll("~", "\\textasciitilde{}").replaceAll("^", "\\textasciicircum{}")
  .replaceAll("–", "\\textendash{}").replaceAll("—", "\\textemdash{}").replaceAll("…", "\\textellipsis{}")
  .replaceAll("×", "\\texttimes{}").replaceAll("·", "\\textperiodcentered{}").replaceAll("©", "\\textcopyright{}")
  .replaceAll("---", "-{}-{}-").replaceAll("--", "-{}-").replaceAll("\x00", "\\textbackslash{}");
// \href{URL}{ and \url{URL} stay one atom: a break hint in an address leaks TeX into the PDF /URI and the link 404s.
const atoms = (e) => e.match(/\\hspace\*?\{[\d.]+em\}|\\href\{[^{}]*\}\{|\\url\{[^{}]*\}|\\[a-zA-Z]+\{\}?|\\.|-\{\}-|[\s\S]/g) || [e];
// Rendered width: \hspace*{Nem} is N/0.5 glyphs, -{}- is two, else one.
const atomW = (a) => { const h = /^\\hspace\*?\{([\d.]+)em\}$/.exec(a); return h ? Math.ceil(Number(h[1]) / 0.5) : a === "-{}-" ? 2 : 1; };
const glyphLen = (e) => atoms(e).reduce((n, a) => n + atomW(a), 0);
// A relative markdown target resolves against the quoted file's tagged
// blob URL; a scheme or a leading / keeps its own root.
const absLink = (pkg, ref, file, u) => {
  const v = u.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (v.startsWith("/")) return `https://github.com/pooriaarab/${pkg}/blob/${ref}${v}`;
  return new URL(v, `https://github.com/pooriaarab/${pkg}/blob/${ref}/${file}`).href;
};
// Prose quotes: strip a leading list marker, set `code` spans in \texttt,
// **bold** in \textbf and [text](url) as \href{url}{text}.
function mdQuote(l, resolve) {
  const parts = String(l).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").split("`"), out = [];
  for (let i = 0; i < parts.length; i++) {
    const tail = i === parts.length - 1 && parts.length % 2 === 0;
    if (i % 2 === 1 && !tail) { out.push(`\\texttt{${tex(parts[i])}}`); continue; }
    const seg = parts[i]
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (m, a, b) => `\x03${resolve(b)}\x04${a}\x05`)
      .replace(/\*\*([^*]+)\*\*/g, "\x01$1\x02");
    out.push((tail ? "\\textasciigrave{}" : "") + tex(seg)
      .replaceAll("\x01", "\\textbf{").replaceAll("\x02", "}")
      .replaceAll("\x03", "\\href{").replaceAll("\x04", "}{").replaceAll("\x05", "}"));
  }
  return out.join("");
}
// Prose wraps at spaces; \allowbreak only opens a mid-token breakpoint when
// one token would overflow the measure on its own.
function wrapProse(e) {
  if (e.length <= 95) return e; const words = []; let w = "";
  for (const a of atoms(e)) { if (a === " ") { words.push(w, " "); w = ""; } else w += a; }
  if (w) words.push(w);
  const parts = []; let cur = "";
  for (const t of words) {
    if (t === " ") { if (cur && !cur.endsWith(" ")) cur += " "; continue; }
    for (let rest = t; rest;) {
      const room = 70 - cur.length;
      if (rest.length <= room) { cur += rest; break; }
      if (cur.trim()) { parts.push(cur.trimEnd()); cur = ""; continue; }
      const at = atoms(rest); let take = 0, acc = 0;
      while (take < at.length && acc + at[take].length <= Math.max(1, room)) acc += at[take++].length;
      parts.push(cur + at.slice(0, take || 1).join("") + "\\allowbreak ");
      rest = at.slice(take || 1).join("");
    }
  }
  if (cur) parts.push(cur);
  return parts.join("\n");
}
// Code lines break with \\ and a hook-arrow continuation; the quote measure fits 62 typewriter glyphs, so wrap at 60.
const CONT = "$\\hookrightarrow$\\hspace*{0.5em}", CODEW = 60;
function wrapCode(e) {
  if (glyphLen(e) <= CODEW) return [e]; const words = []; let w = "";
  for (const a of atoms(e)) { if (a === " ") { words.push(w, " "); w = ""; } else w += a; }
  if (w) words.push(w);
  const parts = []; let cur = "", curW = 0;
  for (const t of words) {
    if (t === " ") { if (cur && !cur.endsWith(" ")) { cur += " "; curW += 1; } continue; }
    for (let rest = t, restW = glyphLen(t); rest;) {
      const room = CODEW - curW - (parts.length ? glyphLen(CONT) : 0);
      if (restW <= room) { cur += rest; curW += restW; break; }
      if (cur.trim()) { parts.push(cur.trimEnd()); cur = " "; curW = 1; continue; }
      const at = atoms(rest); let take = 0, acc = 0;
      while (take < at.length && acc + atomW(at[take]) <= Math.max(1, room)) acc += atomW(at[take++]);
      parts.push(cur + at.slice(0, take || 1).join("")); cur = ""; curW = 0;
      rest = at.slice(take || 1).join(""); restW = glyphLen(rest);
    }
  }
  if (cur) parts.push(cur);
  return parts;
}
const blob = (pkg, ref, f, l) => `https://github.com/pooriaarab/${pkg}/blob/${ref}/${f}#L${l}`;
const locatorLink = (pkg, ref, loc) => {
  const i = loc.match(/^([\w-]+)#(\d+)$/);
  if (i) return `\\href{https://github.com/pooriaarab/${i[1]}/issues/${i[2]}}{\\texttt{${tex(i[1])}\\#${i[2]}}}`;
  const f = loc.match(/^([\w-]+):([\w./-]+)#L(\d+(?:-\d+)?)$/);
  return f ? `\\href{${blob(f[1], ref, f[2], f[3])}}{\\texttt{${tex(f[1])}:\\allowbreak ${tex(f[2])}\\#L${f[3]}}}` : `\\texttt{${tex(loc)}}`;
};
// Leading spaces become \hspace* (a \\ line start discards glue); the rest tie.
const mono = (l) => wrapCode(tex(l).replaceAll("`", "\\textasciigrave{}").replace(/^ +/, (m) => `\\hspace*{${m.length / 2}em}`))
  .map((p) => p.replaceAll(" ", "~")).join(`\\\\\n${CONT}`);
const quote = (pkg, ref, file, it, code = false) => `% quote: ${pkg}/${file}#L${it.line}
\\begin{quote}${code ? "\\ttfamily" : ""}
${code ? it.lines.map((l) => mono(l) + "\\\\").join("\n") : wrapProse(mdQuote(it.lines.join(" "), (u) => absLink(pkg, ref, file, u)))}
\\end{quote}
{\\footnotesize Source: \\href{${blob(pkg, ref, file, it.line)}}{\\texttt{${pkg}:${file}\\#L${it.line}}}.}\n`;
const short = (p) => p.replace(/^benchmark-/, ""), tbl = (cols, spec, rows, caption, label) => `\\begin{table}[H]
\\centering
\\caption{${caption}}
\\label{${label}}
{\\small
\\begin{tabular}{${spec}}
\\toprule
${cols.join(" & ")} \\\\
\\midrule
${rows.join("\n")}
\\bottomrule
\\end{tabular}}
\\end{table}`;
function buildOne(pkg, data) {
  const s = data.suite.packages.find((p) => p.id === pkg), rounds = data.rounds.find((r) => r.id === short(pkg));
  if (!s) fail(`${pkg} has no row in paper/data/suite.json (the engine needs data this generator does not model)`);
  if (!rounds) fail(`${pkg} has no row in paper/data/review-rounds.csv`);
  const council = data.councilPrs.filter((r) => r.repo === pkg); if (!council.length) fail(`${pkg} has no rows in paper/data/council-prs.csv`);
  const defectRows = data.defects.flatMap((d) => {
    const idx = d.packages.split(";").indexOf(short(pkg));
    return idx < 0 ? [] : [{ cls: d.class, source: d.source, locators: d.locators.split(";")[idx].split(" + ") }];
  });
  const approvals = data.approvals.filter((r) => r.repo === pkg), triv = data.trivial.find((r) => r.package === pkg),
    dois = data.dois[pkg] || fail(`${pkg} has no entry in paper/data/zenodo-dois.json`);
  const sumKinds = Object.values(s.kinds).reduce((a, b) => a + b, 0); if (sumKinds !== s.taskCount) fail(`${pkg}: taskCount ${s.taskCount} != kinds sum ${sumKinds}`);
  return { s, rounds, council, defectRows, approvals, triv, dois };
}
const DEFECT_SPEC = "@{}>{\\raggedright\\arraybackslash}p{0.26\\textwidth}>{\\raggedright\\arraybackslash}p{0.3\\textwidth}>{\\raggedright\\arraybackslash}p{0.38\\textwidth}@{}";
async function emit(pkg, data, d) {
  const { s, rounds, council, defectRows, approvals, triv, dois } = d, ref = `v${s.version}`;
  const readme = cachedLines(pkg, "README.md"), pkgJson = JSON.parse(readFileSync(join(cacheDir(pkg), "package.json"), "utf8"));
  if (pkgJson.version !== s.version) fail(`${pkg}: package.json ${pkgJson.version} != suite.json ${s.version}`);
  const docsDir = join(cacheDir(pkg), "docs"), docs = existsSync(docsDir) ? readdirSync(docsDir).filter((f) => f.endsWith(".md")) : [];
  const grading = docs.includes("grading.md") ? cachedLines(pkg, "docs/grading.md") : null, limits = sectionLine(readme, LIMITS_RE);
  const mockSeeds = [...readFileSync(join(root, "scripts/collect.mjs"), "utf8").matchAll(/--seed",\s*"(\d+)"/g)].map((m) => m[1]);
  if (mockSeeds.length < 2) fail("scripts/collect.mjs does not name two mock-run seeds");
  const trivVers = readFileSync(join(root, "paper/data/README.md"), "utf8").match(/at (\d+\.\d+\.\d+) \(`old`\) and (\d+\.\d+\.\d+)\s+\(`new`\)/)
    || fail("paper/data/README.md lacks trivial-check versions");
  const trivN = readFileSync(join(root, "paper/generated/trivial-macros.tex"), "utf8").match(/\\trivialPolicies\}\{(\d+)\}/)
    || fail("paper/generated/trivial-macros.tex lacks \\trivialPolicies");
  const prs = council.map((r) => `\\href{https://github.com/pooriaarab/${pkg}/pull/${r.pr}}{\\#${r.pr}}`
    + ` & ${r.council_reviews} & ${r.approved === "1" ? "yes" : "no"}`
    + ` & ${tex(r.vibecodereview_latest)} & ${tex(r.check_latest)} \\\\`);
  const approvedN = council.filter((r) => r.approved === "1").length, suite = (k) => `paper/data/suite.json ${pkg}.${k}`;
  const macroLines = (l) => l.map(([n, v, src]) => `% source: ${src}\n\\newcommand{\\pkg${n}}{${tex(v)}}`).join("\n");
  const M = macroLines([
    ["Name", s.name, suite("name")], ["Version", s.version, suite("version")],
    ["Status", s.status, suite("status")], ["Saturation", s.saturation ?? "null", suite("saturation")],
    ["Category", s.category, suite("category")], ["TaskCount", s.taskCount, suite("taskCount")],
    ["MockMean", s.seed1.mean, suite("seed1.mean")], ["MockCiLow", s.seed1.ciLow, suite("seed1.ciLow")],
    ["MockCiHigh", s.seed1.ciHigh, suite("seed1.ciHigh")], ["MockPassed", s.seed1.passed, suite("seed1.passed")],
    ["MockCost", s.seed1.costUsd, suite("seed1.costUsd")], ["GoodMean", s.goodMean, suite("goodMean")],
    ["BadMean", s.badMean, suite("badMean")], ["GoodMin", s.goodMin, suite("goodMin")],
    ["BadMax", s.badMax, suite("badMax")], ["PublicSeed", s.publicSeeds.join(", "), suite("publicSeeds")],
    ["MockSeedA", mockSeeds[0], "scripts/collect.mjs mock-run seeds"], ["MockSeedB", mockSeeds[1], "scripts/collect.mjs mock-run seeds"],
    ["FixRounds", rounds.fix_rounds, `paper/data/review-rounds.csv ${pkg}.fix_rounds`],
    ["CouncilPrs", council.length, `paper/data/council-prs.csv ${pkg} row count`],
    ["CouncilApproved", approvedN, `paper/data/council-prs.csv ${pkg} approved count`],
    ["CouncilReviews", council.reduce((a, r) => a + Number(r.council_reviews), 0), `paper/data/council-prs.csv ${pkg} council_reviews sum`],
    ["CouncilFailed", council.filter((r) => r.vibecodereview_any_failure === "1").length, `paper/data/council-prs.csv ${pkg} vibecodereview_any_failure count`],
    ["ConceptDoi", dois.concept_doi, `paper/data/zenodo-dois.json ${pkg}.concept_doi`],
    ["VersionDoi", dois.version_doi, `paper/data/zenodo-dois.json ${pkg}.version_doi`],
    ["SnapshotDate", DATE, "generator invocation date (not data)"],
    ["TrivialVerOld", trivVers[1], "paper/data/README.md trivial.csv note"], ["TrivialVerNew", trivVers[2], "paper/data/README.md trivial.csv note"],
    ["TrivialPolicies", trivN[1], "paper/generated/trivial-macros.tex \\trivialPolicies"],
    ...(triv ? [["TrivialOld", triv.old, `paper/data/trivial.csv ${pkg}.old`],
      ["TrivialNew", triv.new, `paper/data/trivial.csv ${pkg}.new`],
      ["TrivialPolicy", triv.best_policy_old, `paper/data/trivial.csv ${pkg}.best_policy_old`]] : []),
  ]);
  const trivText = triv
    ? `The preregistered check ran \\pkgTrivialPolicies{} generic trivial policies against this package at versions\n`
      + `\\pkgTrivialVerOld{} and \\pkgTrivialVerNew{}. The best trivial score was \\pkgTrivialOld{} at \\pkgTrivialVerOld{}\n`
      + `and \\pkgTrivialNew{} at \\pkgTrivialVerNew{}, won by \\texttt{\\pkgTrivialPolicy{}} (\\texttt{paper/data/trivial.csv}).`
    : `This package was not part of the preregistered check, so \\texttt{paper/data/trivial.csv} carries no row for it.`;
  const apprOne = (r) => `\\texttt{paper/data/approval-defects.csv} records pull request\n`
    + `\\href{https://github.com/pooriaarab/${r.repo}/pull/${r.pr}}{\\#${r.pr}} approved at commit \\texttt{${tex(r.approved_commit)}}\n`
    + `(${tex(r.approved_at)}): the request was approved while a defect a later review found was still in the tree.\n`
    + `The record describes it as: ${tex(r.defect)}. Found by: ${tex(r.found_by)}.\n`
    + `${r.fix_commit ? `Fixed in commit \\texttt{${tex(r.fix_commit)}};` : "The fix landed in a later pull request;"} merged head \\texttt{${tex(r.merged_head)}}.`;
  const apprText = approvals.length ? approvals.map(apprOne).join("\n")
    : `\\texttt{paper/data/approval-defects.csv} lists no documented case of a council approval standing behind a defect found later for this package.`;
  const title = `${pkg} ${s.version} package report`, surfaces = surfaceRows(pkg, readme).map((r) => ({ name: r.name, para: r, code: fenceAfter(readme, r) }));
  const trivClause = !triv ? " It was not part of the preregistered trivial-policy check."
    : triv.old === triv.new ? ` The best trivial policy scored ${triv.old} at both versions.`
    : ` The best trivial policy scored ${triv.old} at ${trivVers[1]} and ${triv.new} at ${trivVers[2]}.`;
  const pubSplit = s.publicSeeds.length ? `over the public task split generated with seed \\pkgPublicSeed{}, on version \\pkgVersion{}:`
    : `on version \\pkgVersion{}. The package declares no public task-split seed. The recorded numbers:`;
  const abstract = `${s.name} (${pkg}) is a public npm benchmark package in the benchmark-* family, version ${s.version}, status ${s.status}.`
    + ` This report records what the package measures in its own words, its deterministic grader and its SDK, CLI, MCP and HTTP surfaces,`
    + ` and the offline validation the family data holds: a scripted good policy mean of ${s.goodMean} and a scripted bad policy mean`
    + ` of ${s.badMean} over ${s.taskCount} tasks, from mock runs at seeds ${mockSeeds[0]} and ${mockSeeds[1]}`
    + (s.publicSeeds.length ? ` on the public task split generated with seed ${s.publicSeeds.join(", ")}` : "; it declares no public task-split seed")
    + `. The review record shows ${rounds.fix_rounds}`
    + ` fix rounds, ${defectRows.length} defect classes with public locators, and ${council.length} merged feature pull requests`
    + ` of which ${approvedN} were approved.${trivClause} No real-model scores are reported.`
    + ` Software concept DOI ${dois.concept_doi}, family paper DOI ${data.dois.paper.version_doi}.`;
  const q = (file, it, code) => quote(pkg, ref, file, it, code), gq = grading ? gradingQuote(grading) : null, cmds = commandQuotes(readme);
  const defectBlock = defectRows.length
    ? `Table~\\ref{tab:defects} lists the defect classes that touched this package, each cell linked to its public record in \\texttt{paper/data/defects.csv}.\n`
      + tbl(["Defect class", "Record kind", "Locators"], DEFECT_SPEC,
        defectRows.map((r) => `\\texttt{${tex(r.cls).replaceAll("-", "-\\allowbreak ")}} & {\\footnotesize ${tex(r.source)}} & ${r.locators.map((l) => locatorLink(pkg, ref, l)).join(";\\ ")} \\\\`),
        `Defect classes touching \\texttt{${pkg}}, from \\texttt{paper/data/defects.csv}.`, "tab:defects")
    : "\\texttt{paper/data/defects.csv} lists no defect class for this package.";
  const paidBlock = cmds.paid.length ? "The README also gives a run against a paid provider; it needs a paid key, and this report does not run it:\n"
    + cmds.paid.map((c) => q("README.md", c, true)).join("") : "";
  const prov = sectionLine(readme, PROV_RE), chg = changelogQuote(cachedLines(pkg, "CHANGELOG.md"));
  const provBlock = prov ? `The README records where the task data comes from:\n${q("README.md", prov)}` : "The package README records no data or provenance section to quote.";
  const gradBlock = grading
    ? `The grading document states the mechanism in its own words:\n${q("docs/grading.md", gq.para)}${gq.code ? q("docs/grading.md", gq.code, true) : ""}`
    : "The package ships no \\texttt{docs/grading.md} document, so there is no grading-document paragraph to quote.";
  const changelogBlock = chg ? `The package changelog for this version states:\n${q("CHANGELOG.md", chg)}`
    : "The package changelog for this version records no score-comparability sentence, so there is no changelog sentence to quote.";
  const taskTbl = tbl(["Task family", "Count"], "ll", Object.entries(s.kinds).map(([k, n]) => `\\texttt{${tex(k)}} & ${n} \\\\`),
    `Task counts per family for \\texttt{${pkg}} version \\protect\\pkgVersion, from \\texttt{paper/data/suite.json}.`, "tab:tasks");
  const surfTbl = tbl(["Surface", "README line"], "ll",
    surfaces.map((r) => `${tex(r.name)} & \\href{${blob(pkg, ref, "README.md", r.para.line)}}{\\texttt{README.md\\#L${r.para.line}}} \\\\`),
    `Runnable surfaces of \\texttt{${pkg}}, each linked to the README line that names it.`, "tab:surfaces");
  const srcTbl = tbl(["Source", "Kind", "Licence"], "lll", s.dataSources.map((d2) => `${tex(d2.name)} & ${tex(d2.kind)} & ${tex(d2.licence)} \\\\`),
    `Declared data sources of \\texttt{${pkg}} from its index entry.`, "tab:sources");
  const body = `% Generated by scripts/pkg-reports.mjs. Do not edit by hand.
\\documentclass{article}
\\PassOptionsToPackage{numbers}{natbib}
\\usepackage[preprint]{neurips_2026}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[hidelinks]{hyperref}
\\usepackage{url}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{float}
\\usepackage{microtype}
${M}
\\title{${tex(title)}}
\\author{Pooria Arab\\\\ Independent researcher\\\\ \\texttt{papers@private-repo-337e.com}}
\\begin{document}
\\maketitle
\\begin{abstract}
${tex(abstract)}
\\end{abstract}
\\section{What the package asks}
The package states its question in its own README:
${q("README.md", questionLine(readme))}
Its index entry states the measured construct as: \`\`${tex(s.whatItMeasures)}\'\' (\\texttt{paper/data/suite.json}, \\texttt{${pkg}.whatItMeasures}).
Table~\\ref{tab:tasks} counts the tasks by family.
${taskTbl}
${tbl(["Field", "Value"], "ll", [
  ["Name", "\\pkgName{}"], ["npm package", `\\texttt{${pkg}}`], ["Version", "\\pkgVersion{}"],
  ["Status", "\\texttt{\\pkgStatus{}}"], ["Saturation", "\\texttt{\\pkgSaturation{}}"], ["Category", "\\pkgCategory{}"],
  ["Tags", s.tags.map((t) => `\\texttt{${tex(t)}}`).join(", ")], ["Public seed", s.publicSeeds.length ? "\\pkgPublicSeed{}" : "none declared"],
  ["Repository", `\\url{${s.repo}}`], ["Documentation", `\\url{${s.docs}}`],
].map(([a, b]) => `${a} & ${b} \\\\`), `Index-entry fields for \\texttt{${pkg}}, from \\texttt{paper/data/suite.json}.`, "tab:facts")}
${provBlock}
\\section{Grader and surfaces}
${gradBlock}
The index entry summarises the grader as: \`\`${tex(s.grader)}\'\' (\\texttt{paper/data/suite.json}, \\texttt{${pkg}.grader}).
Table~\\ref{tab:surfaces} lists the runnable surfaces; each row cites the README line that describes it, and the quoted lines follow.
${surfTbl}
${surfaces.map((r) => q("README.md", r.para, isCmd(r.para.lines[0])) + (r.code ? q("README.md", r.code, true) : "")).join("")}
\\section{Offline validation}
No real model was run. The family data records mock runs at seeds \\pkgMockSeedA{} and \\pkgMockSeedB{}
${pubSplit}
the scripted good policy reaches a mean of \\pkgGoodMean{} (weakest task \\pkgGoodMin{}),
the scripted bad policy a mean of \\pkgBadMean{} (best task \\pkgBadMax{}),
and the run at mock seed \\pkgMockSeedA{} scores \\pkgMockMean{} over \\pkgTaskCount{} tasks
with a bootstrap interval of \\pkgMockCiLow{} to \\pkgMockCiHigh{} (\\pkgMockPassed{} tasks passed; cost \\$\\pkgMockCost{}).
Source: \\texttt{paper/data/suite.json}, collected by \\texttt{scripts/collect.mjs}.
The README prints a sample run:
${q("README.md", sampleQuote(readme, pkg), true)}
\\section{Review record}
The package went through \\pkgFixRounds{} fix rounds recorded in \\texttt{paper/data/review-rounds.csv}, counted from release \\texttt{review-log-v1} of this repository.
${defectBlock}
${changelogBlock}
The merged feature pull requests for this package are listed in Table~\\ref{tab:council}:
\\pkgCouncilPrs{} requests, \\pkgCouncilReviews{} council reviews, \\pkgCouncilApproved{} approvals,
and \\pkgCouncilFailed{} requests that ever showed a failing \\texttt{vibecodereview} run (\\texttt{paper/data/council-prs.csv}).
${tbl(["Pull request", "Council reviews", "Approved", "Council run", "CI check"], "lllll", prs, `Council record for \\texttt{${pkg}}, from \\texttt{paper/data/council-prs.csv}.`, "tab:council")}
${apprText}
\\section{Preregistered trivial-policy check}
The check design is described in the family paper: trivial policies ran each package in the registered set
at \\pkgTrivialVerOld{} and \\pkgTrivialVerNew{} through a local fake model server answering through
the package's own OpenAI provider (\\texttt{paper/sections/prereg.tex}).
${trivText}
\\section{Limitations and what is not claimed}
${limits ? `The package documents its own limit:\n${q("README.md", limits)}` : "The package README carries no limits, scope or caveats section, so there is no package-authored limit to quote."}
This report claims no model capability: it records no real-model run, no leaderboard, and no comparison between models.
These offline numbers describe the graders and the scripted policies. They say nothing about a hosted model.
Package status is \\texttt{\\pkgStatus{}}; saturation is \\texttt{\\pkgSaturation{}} (\\texttt{paper/data/suite.json}).
Disclosure: the package was built by AI coding agents in sessions the author configured, the reviews cited here
are agent reviews, and this report was generated by \\texttt{scripts/pkg-reports.mjs} on \\pkgSnapshotDate{} from the cached sources named above.
\\section{Reproduce}
The README gives the install and the offline run:
${cmds.off.map((c) => q("README.md", c, true)).join("")}
${paidBlock}
\\noindent\\texttt{npm install ${pkg}@\\pkgVersion{}} installs the measured version.
Table~\\ref{tab:sources} lists the declared data sources from the index entry (\\texttt{paper/data/suite.json}).
${srcTbl}
\\section{Cite}
Cite the software record \\texttt{\\pkgConceptDoi{}} (all versions; version \\pkgVersion{} is \\texttt{\\pkgVersionDoi{}})
and the family paper record \\texttt{${data.dois.paper.version_doi}} (\\texttt{paper/data/zenodo-dois.json}).
\\end{document}
`;
  const dir = join(OUT, pkg); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "report.tex"), body);
  const meta = { generated_by: "scripts/pkg-reports.mjs", title, abstract, license: "cc-by-4.0", subject_class: "cs.AI",
    authors: [{ name: "Arab, Pooria", affiliation: "Independent researcher", orcid: process.env.ORCID_ID || null }],
    keywords: ["ai-benchmark", "llm-evaluation", "agent-evaluation", "deterministic-grader", pkg],
    comments: `Generated per-package technical report for ${pkg} ${s.version}; data from pooriaarab/benchmark-family-paper paper/data and cached package sources.`,
    code_url: s.repo, data_url: `https://huggingface.co/datasets/pooria/${pkg}`,
    data_concept_dois: [dois.concept_doi, data.dois.paper.version_doi], venues: [] };
  if (meta.abstract.length < 100 || meta.abstract.length > 1920) fail(`${pkg}: abstract is ${meta.abstract.length} characters`);
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  const sty = join(root, "paper/neurips_2026.sty");
  if (!existsSync(sty) && spawnSync("node", [join(root, "scripts/fetch-style.mjs")], { stdio: "inherit" }).status !== 0) fail("scripts/fetch-style.mjs failed");
  copyFileSync(sty, join(dir, "neurips_2026.sty"));
  const run = spawnSync(process.env.TECTONIC || "tectonic", ["report.tex"], { cwd: dir, encoding: "utf8" });
  if (run.status !== 0) fail(`${pkg}: tectonic failed\n${(run.stdout + run.stderr).split("\n").slice(-12).join("\n")}`);
  console.log(`${pkg}: wrote ${dir}/report.tex, report.pdf, meta.json`);
}
async function main() {
  if (!target) fail("usage: node scripts/pkg-reports.mjs <package|all> [--refresh] [--out DIR] [--date YYYY-MM-DD]");
  const data = { suite: JSON.parse(readFileSync(join(root, "paper/data/suite.json"), "utf8")),
    rounds: readCsv(join(root, "paper/data/review-rounds.csv")), defects: readCsv(join(root, "paper/data/defects.csv")),
    councilPrs: readCsv(join(root, "paper/data/council-prs.csv")), approvals: readCsv(join(root, "paper/data/approval-defects.csv")),
    trivial: readCsv(join(root, "paper/data/trivial.csv")), dois: JSON.parse(readFileSync(join(root, "paper/data/zenodo-dois.json"), "utf8")) };
  const list = target === "all" ? data.suite.packages.map((p) => p.id) : [target];
  if (target !== "all" && !data.dois[target]) fail(`unknown package ${target}`);
  for (const pkg of list) {
    const d = buildOne(pkg, data); await cachePackage(pkg, `v${d.s.version}`);
    console.log(`${pkg}: cache date ${readFileSync(join(cacheDir(pkg), "_fetchedAt"), "utf8").trim()}`);
    await emit(pkg, data, d);
  }
}
await main();
