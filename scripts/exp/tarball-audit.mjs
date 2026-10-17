#!/usr/bin/env node
// E5a tarball audit: scan every pinned artifact's installed tree for
// hidden-split files, answer-bearing data outside the public split, and
// concrete seeds printed in the shipped docs. Also writes the E5 census:
// which artifacts ship a generator with a --split flag plus a --tasks
// CLI flag. Read hidden-audit.failure-modes.md first.
//
//   node scripts/exp/tarball-audit.mjs                     # all 34 artifacts
//   node scripts/exp/tarball-audit.mjs --only a@0.1.0,b@0.1.0 --out /tmp/x

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const HIDDEN_PATH = /(^|\/)([^/]*(hidden|held[-_]?out|heldout|private|secret)[^/]*)$/i;
const ANSWER_NAME = /(answer|solution|oracle|gold|expected|secret|\.key$)/i;
const ANSWER_KEYS = /"(expected|answer|solution|oracle)"\s*:/;
const DOC_FILE = /^(README\.md|AGENTS\.md|llms\.txt|CHANGELOG\.md|server\.json|data\/PROVENANCE\.md|docs\/.*\.(md|txt))$/;
const SEED_WORD = /seed[a-z]*/gi;
const SEED_NUMBER = /(?<![\d,.])\d{3,}(?![\d,.])/g;
const HIDDEN_WORD = /hidden|held[- ]?out|private|unreported|undisclosed/i;
const MAX_FILE = 4 * 1024 * 1024;

function fail(message) {
  console.error(`tarball-audit: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { cache: join(ROOT, ".exp-cache"), out: join(ROOT, "paper/data/exp"), only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cache") args.cache = resolve(argv[++i]);
    else if (argv[i] === "--out") args.out = resolve(argv[++i]);
    else if (argv[i] === "--only") args.only = new Set(argv[++i].split(","));
    else fail(`unknown argument ${argv[i]}`);
  }
  return args;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"` : text;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\n")}\n`;
}

function walk(dir) {
  const out = [];
  const visit = (cur) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const path = join(cur, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  visit(dir);
  return out.sort();
}

function loadPublicTasks(pkgDir) {
  const file = join(pkgDir, "data/tasks.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function canon(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(",")}}`;
}

function expectedNeedles(tasks) {
  const needles = [];
  for (const task of tasks) {
    if (task.expected === undefined) continue;
    const text = typeof task.expected === "string" ? task.expected : canon(task.expected);
    if (text.length >= 64) needles.push(text.length > 4096 ? text.slice(0, 4096) : text);
  }
  return needles;
}

function docSeeds(pkgDir, files) {
  const publicish = new Set();
  const hiddenish = new Set();
  for (const file of files) {
    const rel = relative(pkgDir, file);
    if (!DOC_FILE.test(rel)) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const hidden = HIDDEN_WORD.test(line);
      for (const word of line.matchAll(SEED_WORD)) {
        const near = line.slice(Math.max(0, word.index - 50), word.index + word[0].length + 50);
        for (const num of near.matchAll(SEED_NUMBER)) {
          (hidden ? hiddenish : publicish).add(num[0]);
        }
      }
    }
  }
  return { publicish: [...publicish].sort(), hiddenish: [...hiddenish].sort() };
}

function censusGenerator(pkgDir, files) {
  const scripts = files.filter((f) => relative(pkgDir, f).startsWith("scripts/") && f.endsWith(".mjs"));
  for (const file of scripts) {
    const src = readFileSync(file, "utf8");
    const split = /"--split"|option\("split"|get\("--split"/.test(src);
    if (!split) continue;
    const seed = /"--seed"|option\("seed"|get\("--seed"/.test(src);
    const output = /"--output"|option\("output"|get\("--output"/.test(src) ? "--output"
      : /"--out"|option\("out"|get\("--out"/.test(src) ? "--out" : "";
    const hiddenDefault = (src.match(/"([^"]*hidden[^"]*\.jsonl)"/i) ?? [])[1] ?? "";
    return { path: relative(pkgDir, file), split, seed, output, hiddenDefault, src };
  }
  return null;
}

function hiddenNeedsSeed(pkgDir, gen) {
  // Probe, in a temp cwd, whether the hidden split refuses to run without
  // an explicit seed. Files cannot escape the temp dir.
  if (!gen?.split || !gen?.output) return "n/a";
  const tmp = mkdtempSync(join(tmpdir(), "e5-probe-"));
  try {
    const res = execFileSync("node", [join(pkgDir, gen.path), "--split", "hidden", gen.output, join(tmp, "t.jsonl")],
      { cwd: tmp, env: { PATH: process.env.PATH }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
    void res;
    return "no";
  } catch {
    return "yes";
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
let artifacts = doc.artifacts;
if (args.only) {
  const missing = [...args.only].filter((id) => !artifacts.some((a) => `${a.name}@${a.version}` === id));
  if (missing.length) fail(`not pinned in versions.json: ${missing.join(", ")}`);
  artifacts = artifacts.filter((a) => args.only.has(`${a.name}@${a.version}`));
}
const absent = artifacts.filter((a) => !existsSync(join(args.cache, `${a.name}@${a.version}`, "install.ok")));
if (absent.length) fail(`cache is missing ${absent.map((a) => `${a.name}@${a.version}`).join(", ")}; run scripts/exp/install.mjs first`);

const auditRows = [];
const censusRows = [];
for (const artifact of artifacts) {
  const id = `${artifact.name}@${artifact.version}`;
  const pkgDir = join(args.cache, id, "node_modules", artifact.name);
  if (!existsSync(pkgDir)) fail(`${id}: installed but ${pkgDir} is missing`);
  const files = walk(pkgDir);
  const rel = (f) => relative(pkgDir, f);

  const tasks = loadPublicTasks(pkgDir);
  const needles = expectedNeedles(tasks);
  const hiddenNamed = files.filter((f) => HIDDEN_PATH.test(rel(f)));

  const answerBearing = [];
  for (const file of files) {
    const r = rel(file);
    if (r === "data/tasks.jsonl") continue;
    const via = [];
    if (ANSWER_NAME.test(r)) via.push("name");
    let text = null;
    if (statSync(file).size <= MAX_FILE) {
      try { text = readFileSync(file, "utf8"); } catch { text = null; }
    }
    if (text !== null) {
      if ((r.endsWith(".json") || r.endsWith(".jsonl")) && ANSWER_KEYS.test(text)) via.push("keys");
      for (const needle of needles) {
        if (text.includes(needle)) { via.push("content"); break; }
      }
    }
    if (via.length) answerBearing.push(`${r}:${[...new Set(via)].join("+")}`);
  }

  const seeds = docSeeds(pkgDir, files);
  const gen = censusGenerator(pkgDir, files);
  const distFiles = files.filter((f) => rel(f).startsWith("dist/") && f.endsWith(".js"));
  const tasksFlag = distFiles.some((f) => readFileSync(f, "utf8").includes('"--tasks"'));
  const needsSeed = hiddenNeedsSeed(pkgDir, gen);
  const qualifies = Boolean(gen && gen.split && gen.seed && tasksFlag);

  auditRows.push([
    artifact.name, artifact.version, artifact.wave, files.length,
    existsSync(join(pkgDir, "data/tasks.jsonl")) ? "yes" : "no", tasks.length,
    hiddenNamed.map(rel).join(";") || "none",
    answerBearing.length ? answerBearing.join(";") : "none",
    seeds.publicish.join(";") || "none",
    seeds.hiddenish.join(";") || "none",
  ]);
  censusRows.push([
    artifact.name, artifact.version, artifact.wave,
    gen ? gen.path : "none",
    gen?.split ? "yes" : "no", gen?.seed ? "yes" : "no",
    gen?.output || "none", gen?.hiddenDefault || "none", needsSeed,
    tasksFlag ? "yes" : "no", qualifies ? "yes" : "no",
  ]);
  console.error(`${id}: ${files.length} files, ${hiddenNamed.length} hidden-named, ${answerBearing.length} answer-bearing, qualifies=${qualifies ? "yes" : "no"}`);
}

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "tarball-audit.csv"), csv([
  ["package", "version", "wave", "files", "tasks_file", "public_tasks", "hidden_named_files", "answer_bearing_files", "doc_seeds", "doc_hidden_seed_examples"],
  ...auditRows,
]));
writeFileSync(join(args.out, "hidden-census.csv"), csv([
  ["package", "version", "wave", "generator", "split_flag", "seed_flag", "output_flag", "hidden_default", "hidden_needs_seed", "tasks_flag", "qualifies"],
  ...censusRows,
]));
console.log(`tarball-audit: ${auditRows.length} artifacts -> tarball-audit.csv, hidden-census.csv`);
