#!/usr/bin/env node
// Read paper/data/suite.txt, run each package's published CLI, and write
// paper/data/suite.json plus the LaTeX tables under paper/generated/.
// No dependencies. Package names are taken from the list, never from the network.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const suitePath = join(root, "paper/data/suite.txt");
const jsonPath = join(root, "paper/data/suite.json");
const defectsPath = join(root, "paper/data/defects.csv");
const roundsPath = join(root, "paper/data/review-rounds.csv");
const buildersPath = join(root, "paper/data/builders.csv");
const reviewersPath = join(root, "paper/data/reviewers.csv");
const notesPath = join(root, "paper/data/review-notes.csv");
const genDir = join(root, "paper/generated");

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readSuite() {
  const names = readFileSync(suitePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.length === 0) fail("suite.txt is empty");
  for (const name of names) {
    if (!NAME_RE.test(name)) fail(`refusing package name: ${name}`);
  }
  if (new Set(names).size !== names.length) fail("suite.txt has a duplicate package");
  return names;
}

// Same bit as benchmark-core mockAdapter: ((fnv1a(taskId) ^ seed) & 1) === 1
// selects the scripted good policy. Seed 2 is the complement of seed 1.
function fnv1a(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function mockGood(taskId, seed) {
  return ((fnv1a(taskId) ^ seed) & 1) === 1;
}

function runCli(pkg, args) {
  const result = spawnSync("npx", ["--yes", pkg, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.error) fail(`${pkg} ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-4).join(" ");
    fail(`${pkg} ${args.join(" ")} exited ${result.status}: ${detail}`);
  }
  return result.stdout;
}

function parseJson(stdout, label) {
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    fail(`${label}: stdout was not JSON`);
  }
}

// Index text can carry smart punctuation; normalise it once so the JSON
// data and the generated tables stay plain ASCII.
function plain(value) {
  return String(value)
    .replace(/ *— */g, ", ")
    .replaceAll("–", "-")
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("…", "...")
    .replaceAll(" ", " ");
}

function mean(values) {
  if (values.length === 0) fail("mean of an empty score list");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function fmt(value) {
  return round4(value).toFixed(4);
}

function seedsFrom(sources) {
  const found = new Set();
  for (const source of sources) {
    for (const match of String(source.howToGet || "").matchAll(/--seed\s+(\d+)/g)) found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function collectPackage(pkg) {
  process.stderr.write(`collect ${pkg}\n`);
  const entry = parseJson(runCli(pkg, ["index-entry", "--json"]), `${pkg} index-entry`);
  const provenance = parseJson(runCli(pkg, ["provenance", "--json"]), `${pkg} provenance`);
  const seed1 = parseJson(runCli(pkg, ["run", "--provider", "mock", "--model", "offline", "--seed", "1", "--json"]), `${pkg} seed 1`);
  const seed2 = parseJson(runCli(pkg, ["run", "--provider", "mock", "--model", "offline", "--seed", "2", "--json"]), `${pkg} seed 2`);
  if (!Array.isArray(seed1.rows) || !Array.isArray(seed2.rows)) fail(`${pkg}: run report has no rows`);
  const bySeed2 = new Map(seed2.rows.map((row) => [row.taskId, row]));
  const kinds = {};
  const goodScores = [];
  const badScores = [];
  for (const row of seed1.rows) {
    const other = bySeed2.get(row.taskId);
    if (!other) fail(`${pkg}: task ${row.taskId} missing from seed 2`);
    if (mockGood(row.taskId, 1) === mockGood(row.taskId, 2)) fail(`${pkg}: seeds 1 and 2 did not complement ${row.taskId}`);
    kinds[row.kind] = (kinds[row.kind] || 0) + 1;
    const goodRow = mockGood(row.taskId, 1) ? row : other;
    const badRow = goodRow === row ? other : row;
    goodScores.push(goodRow.score);
    badScores.push(badRow.score);
  }
  if (seed1.rows.length !== seed2.rows.length) fail(`${pkg}: seed row counts differ`);
  if (entry.task_count !== seed1.rows.length) fail(`${pkg}: index task_count ${entry.task_count} != run rows ${seed1.rows.length}`);
  const kindNames = Object.keys(kinds).sort();
  const sources = Array.isArray(provenance.provenance) ? provenance.provenance : [];
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    status: entry.status,
    saturation: entry.saturation ?? null,
    category: entry.category,
    tags: entry.tags,
    taskCount: entry.task_count,
    kinds,
    kind: kindNames.length === 1 ? kindNames[0] : "mixed",
    whatItMeasures: plain(entry.what_it_measures),
    grader: plain(entry.grader),
    npm: entry.npm,
    repo: entry.repo,
    docs: entry.docs,
    dataSources: sources.map((source) => ({
      name: source.name,
      kind: source.kind,
      licence: source.licence,
    })),
    publicSeeds: seedsFrom(sources),
    seed1: {
      mean: round4(seed1.mean),
      ciLow: round4(seed1.confidenceInterval95.low),
      ciHigh: round4(seed1.confidenceInterval95.high),
      passed: seed1.totals.passed,
      tasks: seed1.totals.tasks,
      costUsd: seed1.totals.costUsd ?? 0,
    },
    goodMean: round4(mean(goodScores)),
    badMean: round4(mean(badScores)),
    goodMin: round4(Math.min(...goodScores)),
    badMax: round4(Math.max(...badScores)),
  };
}

function tex(value) {
  return String(value)
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("$", "\\$")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}")
    .replaceAll("–", "--")
    .replace(/ *— */g, ", ")
    .replaceAll("‘", "`")
    .replaceAll("’", "'")
    .replaceAll("“", "``")
    .replaceAll("”", "''")
    .replaceAll("…", "\\dots{}")
    .replaceAll(" ", "~");
}

function tt(value) {
  return `\\texttt{${tex(value)}}`;
}

function ttId(id) {
  return tex(id.replace(/^benchmark-/, ""))
    .split("-")
    .map((part) => `\\texttt{${part}}`)
    .join("-\\allowbreak");
}

const RAG = ">{\\raggedright\\arraybackslash}";

// Committed CSVs use semicolons inside fields, never commas or quotes,
// so a plain split is the whole parser.
function readCsv(path) {
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) fail(`${path} has no data rows`);
  const header = lines.shift().split(",");
  return lines.map((line) => {
    const fields = line.split(",");
    if (fields.length !== header.length) fail(`${path}: bad row ${line}`);
    const row = {};
    header.forEach((name, index) => {
      row[name] = fields[index];
    });
    return row;
  });
}

function camelId(id) {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtInt(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function joinList(values) {
  return [...new Set(values)].sort().map(tex).join(", ");
}

function writeJson(doc) {
  const lines = ["{"];
  lines.push(`  "collectedAt": ${JSON.stringify(doc.collectedAt)},`);
  lines.push(`  "mock": ${JSON.stringify(doc.mock)},`);
  lines.push('  "packages": [');
  doc.packages.forEach((pkg, index) => {
    const comma = index === doc.packages.length - 1 ? "" : ",";
    lines.push(`    ${JSON.stringify(pkg)}${comma}`);
  });
  lines.push("  ]");
  lines.push("}");
  writeFileSync(jsonPath, `${lines.join("\n")}\n`);
}

function macros(doc) {
  const packages = doc.packages;
  const tasks = packages.reduce((sum, pkg) => sum + pkg.taskCount, 0);
  const single = packages.filter((pkg) => pkg.kind === "single").length;
  const episode = packages.filter((pkg) => pkg.kind === "episode").length;
  const versions = [...new Set(packages.map((pkg) => pkg.version))];
  const statuses = [...new Set(packages.map((pkg) => pkg.status))];
  const saturations = [...new Set(packages.map((pkg) => (
    pkg.saturation === null || pkg.saturation === "unknown" ? "unknown" : String(pkg.saturation)
  )))];
  const seeds = [...new Set(packages.flatMap((pkg) => pkg.publicSeeds))];
  const costs = packages.map((pkg) => pkg.seed1.costUsd);
  const lines = [
    "% Generated by scripts/collect.mjs. Do not edit.",
    `\\newcommand{\\suitePackages}{${packages.length}}`,
    `\\newcommand{\\suiteTasks}{${tasks}}`,
    `\\newcommand{\\suiteTasksMin}{${Math.min(...packages.map((pkg) => pkg.taskCount))}}`,
    `\\newcommand{\\suiteTasksMax}{${Math.max(...packages.map((pkg) => pkg.taskCount))}}`,
    `\\newcommand{\\suiteSingle}{${single}}`,
    `\\newcommand{\\suiteEpisode}{${episode}}`,
    `\\newcommand{\\suiteVersion}{${tex(versions.length === 1 ? versions[0] : "mixed")}}`,
    `\\newcommand{\\suiteStatus}{${tex(statuses.length === 1 ? statuses[0] : "mixed")}}`,
    `\\newcommand{\\suiteSaturation}{${tex(saturations.length === 1 ? saturations[0] : "mixed")}}`,
    `\\newcommand{\\suitePublicSeed}{${seeds.length === 1 ? seeds[0] : "mixed"}}`,
    `\\newcommand{\\suiteMockCost}{${costs.every((cost) => cost === 0) ? "0" : "mixed"}}`,
    `\\newcommand{\\suiteGoodFloor}{${fmt(Math.min(...packages.map((pkg) => pkg.goodMin)))}}`,
    `\\newcommand{\\suiteBadCeiling}{${fmt(Math.max(...packages.map((pkg) => pkg.badMax)))}}`,
    `\\newcommand{\\suiteOraclePackages}{${packages.filter((pkg) => pkg.goodMean === 1).length}}`,
    `\\newcommand{\\suiteMinPairedDiff}{${fmt(Math.min(...packages.map((pkg) => pkg.goodMean - pkg.badMean)))}}`,
  ];
  for (const pkg of packages) {
    const camel = pkg.id
      .replace(/^benchmark-/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    if (pkg.goodMean !== 1) lines.push(`\\newcommand{\\suiteGood${camel}}{${fmt(pkg.goodMean)}}`);
    if (pkg.badMean !== 0) lines.push(`\\newcommand{\\suiteBad${camel}}{${fmt(pkg.badMean)}}`);
  }
  return `${lines.join("\n")}\n`;
}

function summary(doc) {
  return [
    "% Generated by scripts/collect.mjs. Do not edit.",
    `The run covered \\suitePackages{} packages and \\suiteTasks{} tasks.`,
    "",
  ].join("\n");
}

function suiteTable(doc) {
  const rows = doc.packages.map((pkg) => [
    ttId(pkg.id),
    tt(pkg.version),
    tex(pkg.kind),
    String(pkg.taskCount),
    tex(pkg.category),
    joinList(pkg.dataSources.map((source) => source.kind)),
    joinList(pkg.dataSources.map((source) => source.licence)),
  ].join(" & ") + " \\\\");
  return [
    "% Generated by scripts/collect.mjs. Do not edit.",
    "\\begin{table}[t]",
    "\\centering",
    "\\small",
    "\\setlength{\\tabcolsep}{3pt}",
    `\\begin{tabular}{@{}${RAG}p{0.17\\textwidth}l${RAG}p{0.08\\textwidth}r${RAG}p{0.14\\textwidth}${RAG}p{0.20\\textwidth}${RAG}p{0.17\\textwidth}@{}}`,
    "\\toprule",
    "Package & Ver. & Kind & Tasks & Category & Data & Licence \\\\",
    "\\midrule",
    ...rows,
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Suite measured from \\texttt{index-entry} and a mock run. Package names omit the \\texttt{benchmark-} prefix. Data and licence list the distinct provenance fields.}",
    "\\label{tab:suite}",
    "\\end{table}",
    "",
  ].join("\n");
}

function mockTable(doc) {
  const rows = doc.packages.map((pkg) => [
    ttId(pkg.id),
    fmt(pkg.seed1.mean),
    `${fmt(pkg.seed1.ciLow)} to ${fmt(pkg.seed1.ciHigh)}`,
    fmt(pkg.goodMean),
    fmt(pkg.badMean),
  ].join(" & ") + " \\\\");
  return [
    "% Generated by scripts/collect.mjs. Do not edit.",
    "\\begin{table}[t]",
    "\\centering",
    "\\small",
    "\\begin{tabular}{@{}lrlrr@{}}",
    "\\toprule",
    "Package & Seed 1 & 95\\% interval & Good & Bad \\\\",
    "\\midrule",
    ...rows,
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Mock provider, model \\texttt{offline}. Seed 1 is the default mix. Good and bad are the same tasks rescored by pairing seed 1 with seed 2, which flips the engine's mock bit. The interval is the engine's seeded bootstrap on the seed-1 scores.}",
    "\\label{tab:mock}",
    "\\end{table}",
    "",
  ].join("\n");
}

// Index text is quoted verbatim except one em dash that plain() flattened
// into a comma splice in the schema-mutation entry; print it as a colon.
function indexText(value) {
  return tex(value).replace(
    "after a migration, renamed fields",
    "after a migration: renamed fields",
  );
}

function graderTable(doc) {
  const rows = doc.packages.map((pkg) =>
    `${ttId(pkg.id)} & ${indexText(pkg.whatItMeasures)} & ${tex(pkg.grader)} \\\\`);
  return [
    "% Generated by scripts/collect.mjs. Do not edit.",
    `\\begin{longtable}{@{}${RAG}p{0.18\\textwidth}${RAG}p{0.37\\textwidth}${RAG}p{0.37\\textwidth}@{}}`,
    "\\caption{Index text for what each package measures and how it says it grades.\\label{tab:graders}}\\\\",
    "\\toprule",
    "Package & What it measures & Grader \\\\",
    "\\midrule",
    "\\endfirsthead",
    "\\toprule",
    "Package & What it measures & Grader \\\\",
    "\\midrule",
    "\\endhead",
    ...rows.flatMap((row) => [row, "\\addlinespace"]),
    "\\bottomrule",
    "\\end{longtable}",
    "",
  ].join("\n");
}

function ttList(ids) {
  return ids.split(";").map((id) => `\\texttt{${tex(id)}}`).join(";\\ ");
}

function defectsMacrosTex() {
  const rows = readCsv(defectsPath);
  const lines = [
    "% Generated by scripts/collect.mjs from paper/data/defects.csv. Do not edit.",
    `\\newcommand{\\defectClasses}{${rows.length}}`,
  ];
  for (const row of rows) {
    lines.push(`\\newcommand{\\defect${camelId(row.class)}}{${row.at_least}}`);
  }
  return `${lines.join("\n")}\n`;
}

function defectsTableTex() {
  const rows = readCsv(defectsPath);
  const lines = [
    "% Generated by scripts/collect.mjs from paper/data/defects.csv. Do not edit.",
  ];
  const tableRows = rows.map((row) => [
    tex(row.class.replaceAll("-", " ")),
    ttList(row.packages),
    row.at_least,
    tex(row.source),
  ].join(" & ") + " \\\\");
  lines.push(
    "\\begin{table}[t]",
    "\\centering",
    "\\footnotesize",
    `\\begin{tabular}{@{}${RAG}p{0.16\\textwidth}${RAG}p{0.40\\textwidth}r${RAG}p{0.24\\textwidth}@{}}`,
    "\\toprule",
    "Class & Packages & At least & Source \\\\",
    "\\midrule",
    ...tableRows,
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Defect classes recorded by the independent review, generated from \\texttt{paper/data/defects.csv}. Each count is a sourced minimum: the public record can hold more.}",
    "\\label{tab:defects}",
    "\\end{table}",
    "",
  );
  return `${lines.join("\n")}`;
}

function reviewTex() {
  const rows = readCsv(roundsPath);
  const rounds = rows.map((row) => Number(row.fix_rounds));
  if (rounds.some((value) => !Number.isInteger(value) || value < 0)) {
    fail("review-rounds.csv has a non-integer fix_rounds");
  }
  const total = rounds.reduce((sum, value) => sum + value, 0);
  const waveOne = rows.filter((row) => row.wave === "1").length;
  return [
    "% Generated by scripts/collect.mjs from paper/data/review-rounds.csv. Do not edit.",
    `\\newcommand{\\reviewPackages}{${rows.length}}`,
    `\\newcommand{\\reviewRoundsMin}{${Math.min(...rounds)}}`,
    `\\newcommand{\\reviewRoundsMax}{${Math.max(...rounds)}}`,
    `\\newcommand{\\reviewRoundsMedian}{${fmtInt(median(rounds))}}`,
    `\\newcommand{\\reviewRoundsTotal}{${total}}`,
    `\\newcommand{\\reviewWaveOne}{${waveOne}}`,
    "",
  ].join("\n");
}

// Locators in defects.csv align with the packages column: the i-th
// semicolon-separated locator set sources the i-th package.
function defectLocatorsTex() {
  const cells = [];
  for (const row of readCsv(defectsPath)) {
    const packages = row.packages.split(";");
    const locators = row.locators.split(";");
    if (packages.length !== locators.length) {
      fail(`defects.csv ${row.class}: ${packages.length} packages but ${locators.length} locator sets`);
    }
    packages.forEach((pkg, index) => {
      const refs = locators[index].split(" + ").map((ref) =>
        `\\texttt{${tex(ref).split(":").join(":\\allowbreak ")}}`).join(";\\ \\allowbreak ");
      cells.push([tex(row.class.replaceAll("-", " ")), ttId(`benchmark-${pkg}`), refs].join(" & ") + " \\\\");
    });
  }
  return [
    "% Generated by scripts/collect.mjs from paper/data/defects.csv. Do not edit.",
    "\\section{Defect locators}\\label{app:locators}",
    "Every package cell in Table~\\ref{tab:defects} rests on a public record. \\texttt{<repo>\\#n} is issue or pull request n in \\texttt{pooriaarab/<repo>}; \\texttt{<repo>:CHANGELOG.md\\#Ln} is line n of the changelog on \\texttt{main}, checked on 2026-10-16.",
    "{\\footnotesize",
    `\\begin{longtable}{@{}${RAG}p{0.16\\textwidth}${RAG}p{0.16\\textwidth}${RAG}p{0.60\\textwidth}@{}}`,
    "\\toprule Class & Package & Locator \\\\ \\midrule \\endfirsthead",
    "\\toprule Class & Package & Locator \\\\ \\midrule \\endhead",
    ...cells.flatMap((row) => [row, "\\addlinespace"]),
    "\\bottomrule",
    "\\end{longtable}}",
    "",
  ].join("\n");
}

let builderTotalsCache;
function builderTotals() {
  if (!builderTotalsCache) {
    builderTotalsCache = readCsv(buildersPath).reduce((acc, row) => ({
      feature: acc.feature + Number(row.merged_feature),
      chore: acc.chore + Number(row.merged_chore),
      closed: acc.closed + Number(row.closed),
      open: acc.open + Number(row.open),
      total: acc.total + Number(row.total),
    }), { feature: 0, chore: 0, closed: 0, open: 0, total: 0 });
  }
  return builderTotalsCache;
}

function buildersTex() {
  const t = builderTotals();
  const rows = readCsv(buildersPath).map((row) =>
    [tt(row.agent), row.merged_feature, row.merged_chore, row.closed, row.open, row.total].join(" & ") + " \\\\");
  return [
    "% Generated by scripts/collect.mjs from paper/data/builders.csv. Do not edit.",
    "\\begin{table}[t]\\centering\\small",
    "\\begin{tabular}{@{}lrrrrr@{}}",
    "\\toprule",
    "\\texttt{Assisted-by} trailer & merged & chores & closed & open & total \\\\",
    "\\midrule",
    ...rows,
    `\\midrule Total & ${t.feature} & ${t.chore} & ${t.closed} & ${t.open} & ${t.total} \\\\`,
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Builders of record, generated from \\texttt{paper/data/builders.csv} (\\texttt{scripts/builders.mjs}, GitHub record of 2026-10-16). Every pull request in the \\suitePackages{} package repositories carries an \\texttt{Assisted-by} trailer naming a coding agent. The merged column splits feature work from chores (a chore title starts with ``Add CITATION'', ``Add the Zenodo DOI'' or ``Publish to ants.land''); the closed column holds stacked pull requests superseded by the merged chain.}\\label{tab:builders}",
    "\\end{table}",
    "",
  ].join("\n");
}

// builders.csv gives the PR totals; the council account is `claude` in
// reviewers.csv; review-notes.csv carries one key,value,locator per small
// sourced number the prose quotes.
function reviewDataMacrosTex() {
  const t = builderTotals();
  const council = readCsv(reviewersPath).find((row) => row.account === "claude");
  if (!council) fail("reviewers.csv has no claude row");
  const lines = [
    "% Generated by scripts/collect.mjs from the review data files. Do not edit.",
    `\\newcommand{\\buildersPrs}{${t.total}}`,
    `\\newcommand{\\buildersMerged}{${t.feature + t.chore}}`,
    `\\newcommand{\\buildersMergedFeature}{${t.feature}}`,
    `\\newcommand{\\buildersMergedChore}{${t.chore}}`,
    `\\newcommand{\\buildersClosed}{${t.closed}}`,
    `\\newcommand{\\buildersOpen}{${t.open}}`,
    `\\newcommand{\\councilReviews}{${council.reviews}}`,
    `\\newcommand{\\councilPrsReviewed}{${council.prs_reviewed}}`,
  ];
  for (const row of readCsv(notesPath)) {
    lines.push(`\\newcommand{\\note${row.key}}{${tex(row.value)}}`);
  }
  return `${lines.join("\n")}\n`;
}

// pgfplots cannot read the locators column (the # in "repo#n" is a TeX
// parameter token), so the figure reads a two-column projection instead.
function defectsPlotCsv() {
  const rows = readCsv(defectsPath);
  return `${["class,at_least", ...rows.map((row) => `${row.class},${row.at_least}`)].join("\n")}\n`;
}

function mockScoresCsv(doc) {
  const rows = doc.packages.map((pkg) => [
    pkg.id.replace(/^benchmark-/, ""),
    fmt(pkg.goodMean),
    fmt(pkg.badMean),
    fmt(pkg.seed1.mean),
    fmt(pkg.seed1.ciLow),
    fmt(pkg.seed1.ciHigh),
    fmt(pkg.seed1.mean - pkg.seed1.ciLow),
    fmt(pkg.seed1.ciHigh - pkg.seed1.mean),
  ].join(","));
  return `${["package,good,bad,seed1,ciLow,ciHigh,em,ep", ...rows].join("\n")}\n`;
}

function rewriteTables(doc) {
  mkdirSync(genDir, { recursive: true });
  writeFileSync(join(genDir, "macros.tex"), macros(doc));
  writeFileSync(join(genDir, "summary.tex"), summary(doc));
  writeFileSync(join(genDir, "suite-table.tex"), suiteTable(doc));
  writeFileSync(join(genDir, "mock-table.tex"), mockTable(doc));
  writeFileSync(join(genDir, "graders.tex"), graderTable(doc));
  writeFileSync(join(genDir, "defects-macros.tex"), defectsMacrosTex());
  writeFileSync(join(genDir, "defects.tex"), defectsTableTex());
  writeFileSync(join(genDir, "defect-locators.tex"), defectLocatorsTex());
  writeFileSync(join(genDir, "builders.tex"), buildersTex());
  writeFileSync(join(genDir, "review-data.tex"), reviewDataMacrosTex());
  writeFileSync(join(genDir, "review.tex"), reviewTex());
  writeFileSync(join(genDir, "defects-plot.csv"), defectsPlotCsv());
  writeFileSync(join(genDir, "mock-scores.csv"), mockScoresCsv(doc));
}

function main() {
  if (process.argv.includes("--from-json")) {
    const doc = JSON.parse(readFileSync(jsonPath, "utf8"));
    rewriteTables(doc);
    console.log(`${doc.packages.length} packages -> tables rewritten, ok`);
    return;
  }
  const names = readSuite();
  const packages = names.map(collectPackage);
  const doc = {
    collectedAt: new Date().toISOString(),
    mock: { provider: "mock", model: "offline", seeds: [1, 2] },
    packages,
  };
  mkdirSync(genDir, { recursive: true });
  writeJson(doc);
  rewriteTables(doc);
  const tasks = packages.reduce((sum, pkg) => sum + pkg.taskCount, 0);
  for (const pkg of packages) {
    console.log(`${pkg.id} tasks=${pkg.taskCount} kind=${pkg.kind} seed1=${fmt(pkg.seed1.mean)} good=${fmt(pkg.goodMean)} bad=${fmt(pkg.badMean)}`);
  }
  console.log(`${packages.length} packages, ${tasks} tasks -> collect, ok`);
}

main();
