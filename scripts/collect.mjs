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
    whatItMeasures: entry.what_it_measures,
    grader: entry.grader,
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
    .replaceAll("^", "\\textasciicircum{}");
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
    `\\newcommand{\\suiteSingle}{${single}}`,
    `\\newcommand{\\suiteEpisode}{${episode}}`,
    `\\newcommand{\\suiteVersion}{${tex(versions.length === 1 ? versions[0] : "mixed")}}`,
    `\\newcommand{\\suiteStatus}{${tex(statuses.length === 1 ? statuses[0] : "mixed")}}`,
    `\\newcommand{\\suiteSaturation}{${tex(saturations.length === 1 ? saturations[0] : "mixed")}}`,
    `\\newcommand{\\suitePublicSeed}{${seeds.length === 1 ? seeds[0] : "mixed"}}`,
    `\\newcommand{\\suiteMockCost}{${costs.every((cost) => cost === 0) ? "0" : "mixed"}}`,
    `\\newcommand{\\suiteGoodFloor}{${fmt(Math.min(...packages.map((pkg) => pkg.goodMin)))}}`,
    `\\newcommand{\\suiteBadCeiling}{${fmt(Math.max(...packages.map((pkg) => pkg.badMax)))}}`,
  ];
  return `${lines.join("\n")}\n`;
}

function summary(doc) {
  const partial = doc.packages.filter((pkg) => pkg.badMean > 0);
  const partialText = partial.length === 0
    ? "The scripted bad policy also scores 0 on every package."
    : `The scripted bad policy scores 0 on every package except ${partial.map((pkg) => `${tt(pkg.id)} (${fmt(pkg.badMean)})`).join(" and ")}.`;
  return [
    "% Generated by scripts/collect.mjs. Do not edit.",
    `The run covered \\suitePackages{} packages and \\suiteTasks{} tasks.`,
    `\\suiteSingle{} packages are single-answer tasks and \\suiteEpisode{} are episodes.`,
    "Every index entry in this run reports status",
    `\\texttt{\\suiteStatus{}} and saturation \\texttt{\\suiteSaturation{}}.`,
    "The scripted good policy scores",
    `\\suiteGoodFloor{} on its weakest task.`,
    partialText,
    "Reported mock cost is \\suiteMockCost{}.",
    "Generator commands that name a public seed all name \\suitePublicSeed{}.",
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
    `\\begin{tabular}{@{}${RAG}p{0.13\\textwidth}l${RAG}p{0.08\\textwidth}r${RAG}p{0.14\\textwidth}${RAG}p{0.23\\textwidth}${RAG}p{0.18\\textwidth}@{}}`,
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

function graderTable(doc) {
  const rows = doc.packages.map((pkg) =>
    `${ttId(pkg.id)} & ${tex(pkg.whatItMeasures)} & ${tex(pkg.grader)} \\\\`);
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

function rewriteTables(doc) {
  mkdirSync(genDir, { recursive: true });
  writeFileSync(join(genDir, "macros.tex"), macros(doc));
  writeFileSync(join(genDir, "summary.tex"), summary(doc));
  writeFileSync(join(genDir, "suite-table.tex"), suiteTable(doc));
  writeFileSync(join(genDir, "mock-table.tex"), mockTable(doc));
  writeFileSync(join(genDir, "graders.tex"), graderTable(doc));
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
