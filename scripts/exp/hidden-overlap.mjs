#!/usr/bin/env node
// E5b hidden-split overlap: for every census-qualified artifact, regenerate
// the hidden split at the five frozen seeds and measure overlap with the
// shipped public split. Read hidden-audit.failure-modes.md first.
//
//   node scripts/exp/hidden-overlap.mjs                    # all qualifying
//   node scripts/exp/hidden-overlap.mjs --only a@0.2.0 --cache /tmp/c --out /tmp/o

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const CENSUS = join(ROOT, "paper/data/exp/hidden-census.csv");
const SEEDS = join(ROOT, "scripts/exp/hidden-seeds.json");
const HIDDEN_PREFIX = /^h[-_]/;

function fail(message) {
  console.error(`hidden-overlap: ${message}`);
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function canon(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(",")}}`;
}

function norm(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function normHash(value) {
  const text = typeof value === "string" ? value : canon(value);
  return createHash("sha256").update(norm(text)).digest("hex");
}

function loadTasks(file, { required = false } = {}) {
  if (!existsSync(file)) {
    if (required) fail(`missing ${file}`);
    return [];
  }
  const tasks = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    let parsed;
    try { parsed = JSON.parse(lines[i]); }
    catch { fail(`${file}: malformed JSON on line ${i + 1}`); }
    if (parsed !== null) tasks.push(parsed);
  }
  return tasks;
}

function generate(pkgDir, gen, seed, outFile) {
  try {
    execFileSync("node", [join(pkgDir, gen.path), "--split", "hidden", "--seed", String(seed), gen.output, outFile], {
      cwd: pkgDir,
      env: { PATH: process.env.PATH },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    fail(`${gen.path} failed at seed ${seed}: ${String(err.stderr ?? err.message).trim().slice(0, 400)}`);
  }
  if (!existsSync(outFile)) fail(`${gen.path} exited 0 at seed ${seed} but wrote no ${outFile}`);
  return loadTasks(outFile);
}

const args = parseArgs(process.argv.slice(2));
const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
const seedDoc = JSON.parse(readFileSync(SEEDS, "utf8"));
const censusRows = parseCsv(readFileSync(CENSUS, "utf8"));
const header = censusRows.shift();
const col = (name) => header.indexOf(name);
if (col("qualifies") === -1 || col("generator") === -1) fail("hidden-census.csv: missing columns; regenerate it with tarball-audit.mjs");

let wanted = doc.artifacts;
if (args.only) {
  const missing = [...args.only].filter((id) => !wanted.some((a) => `${a.name}@${a.version}` === id));
  if (missing.length) fail(`not pinned in versions.json: ${missing.join(", ")}`);
  wanted = wanted.filter((a) => args.only.has(`${a.name}@${a.version}`));
}

const censusById = new Map();
for (const row of censusRows) {
  if (row.length < header.length) continue;
  censusById.set(`${row[col("package")]}@${row[col("version")]}`, row);
}

const absent = wanted.filter((a) => !existsSync(join(args.cache, `${a.name}@${a.version}`, "install.ok")));
if (absent.length) fail(`cache is missing ${absent.map((a) => `${a.name}@${a.version}`).join(", ")}; run scripts/exp/install.mjs first`);

const rows = [];
const skipped = [];
for (const artifact of wanted) {
  const id = `${artifact.name}@${artifact.version}`;
  const census = censusById.get(id);
  if (!census || census[col("qualifies")] !== "yes") {
    skipped.push(id);
    continue;
  }
  const pkgDir = join(args.cache, id, "node_modules", artifact.name);
  const gen = { path: census[col("generator")], output: census[col("output_flag")] };
  if (!existsSync(join(pkgDir, gen.path))) fail(`${id}: census names ${gen.path} but it is absent from the tarball`);

  const publicTasks = loadTasks(join(pkgDir, "data/tasks.jsonl"), { required: true });
  const pubPromptExact = new Set(publicTasks.filter((t) => t.prompt !== undefined).map((t) => canon(t.prompt)));
  const pubPromptNorm = new Set(publicTasks.filter((t) => t.prompt !== undefined).map((t) => normHash(t.prompt)));
  const pubExpectedExact = new Set(publicTasks.filter((t) => t.expected !== undefined).map((t) => canon(t.expected)));
  const pubExpectedNorm = new Set(publicTasks.filter((t) => t.expected !== undefined).map((t) => normHash(t.expected)));
  const pubIds = new Set(publicTasks.map((t) => t.id));

  const tmp = mkdtempSync(join(tmpdir(), "e5-hidden-"));
  try {
    for (const seed of seedDoc.seeds) {
      const outFile = join(tmp, `${artifact.name}-${seed}.jsonl`);
      const hidden = generate(pkgDir, gen, seed, outFile);
      const withPrompt = hidden.filter((t) => t.prompt !== undefined);
      const withExpected = hidden.filter((t) => t.expected !== undefined);
      rows.push([
        artifact.name, artifact.version, artifact.wave, seed, gen.path,
        hidden.length, publicTasks.length,
        withPrompt.length,
        withPrompt.filter((t) => pubPromptExact.has(canon(t.prompt))).length,
        withPrompt.filter((t) => pubPromptNorm.has(normHash(t.prompt))).length,
        withExpected.length,
        withExpected.filter((t) => pubExpectedExact.has(canon(t.expected))).length,
        withExpected.filter((t) => pubExpectedNorm.has(normHash(t.expected))).length,
        hidden.filter((t) => pubIds.has(t.id)).length,
        hidden.filter((t) => typeof t.id === "string" && HIDDEN_PREFIX.test(t.id) && pubIds.has(t.id.replace(HIDDEN_PREFIX, ""))).length,
      ]);
      console.error(`${id} seed ${seed}: ${hidden.length} hidden tasks measured`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
for (const id of skipped) console.error(`${id}: no qualifying generator, skipped`);

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "hidden-overlap.csv"), csv([
  ["package", "version", "wave", "seed", "generator", "hidden_tasks", "public_tasks",
    "prompt_pairs", "prompt_exact_overlap", "prompt_norm_overlap",
    "expected_pairs", "expected_exact_overlap", "expected_norm_overlap",
    "id_exact_overlap", "id_suffix_overlap"],
  ...rows,
]));
console.log(`hidden-overlap: ${rows.length} seed rows across ${new Set(rows.map((r) => `${r[0]}@${r[1]}`)).size} artifacts -> hidden-overlap.csv`);
