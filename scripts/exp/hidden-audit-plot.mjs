#!/usr/bin/env node
// F8 hidden-split audit projection: turn paper/data/exp/tarball-audit.csv,
// hidden-census.csv and hidden-overlap.csv into the figure inputs under
// paper/generated/ (leak-cell grid, row and column labels, jittered
// overlap scatter, axis-bound macros).
// See scripts/exp/hidden-audit-plot.failure-modes.md for the guards.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const SEEDS = join(ROOT, "scripts/exp/hidden-seeds.json");
const AUDIT = join(ROOT, "paper/data/exp/tarball-audit.csv");
const CENSUS = join(ROOT, "paper/data/exp/hidden-census.csv");
const OVERLAP = join(ROOT, "paper/data/exp/hidden-overlap.csv");
const OUT_DIR = join(ROOT, "paper/generated");
const AUDIT_HEADER = ["package", "version", "wave", "files", "tasks_file", "public_tasks", "hidden_named_files", "answer_bearing_files", "doc_seeds", "doc_hidden_seed_examples"];
const CENSUS_HEADER = ["package", "version", "wave", "generator", "split_flag", "seed_flag", "output_flag", "hidden_default", "hidden_needs_seed", "tasks_flag", "qualifies"];
const OVERLAP_HEADER = ["package", "version", "wave", "seed", "generator", "hidden_tasks", "public_tasks", "prompt_pairs", "prompt_exact_overlap", "prompt_norm_overlap", "expected_pairs", "expected_exact_overlap", "expected_norm_overlap", "id_exact_overlap", "id_suffix_overlap"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
// A bare four-digit year is not a seed value; the seed-examples
// column counts only values that are neither the public seed nor a
// year, the same recount macros.mjs applies (issue #212, M9).
const YEAR_RE = /^(19|20)\d{2}$/;
const LEAK_COLS = ["hidden files", "answer files", "other seed-like values"];
const JITTER = 0.14;

function fail(message) {
  console.error(`hidden-audit-plot: ${message}`);
  process.exit(1);
}

function readCsv(path, header) {
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) fail(`${path} has no data rows`);
  const head = lines.shift().split(",");
  if (JSON.stringify(head) !== JSON.stringify(header)) {
    fail(`${path}: header is ${head.join(",")}, expected ${header.join(",")}`);
  }
  return lines.map((line) => {
    const fields = line.split(",");
    if (fields.length !== header.length) fail(`${path}: bad row ${line}`);
    return Object.fromEntries(header.map((name, index) => [name, fields[index]]));
  });
}

function int(path, row, field) {
  const value = Number(row[field]);
  if (!Number.isInteger(value) || value < 0) {
    fail(`${path}: ${field} is not a nonneg integer in ${Object.values(row).join(",").slice(0, 80)}`);
  }
  return value;
}

// A `;`-joined list where `none` means empty; anything else must be
// non-empty entries, so a formatting drift can never pass as a count.
// `filter` drops the public seed and bare years before counting, the
// recount the seed-examples column applies (issue #212, M9).
function listCount(path, row, field, filter) {
  const value = row[field].trim();
  if (value === "none") return 0;
  const parts = value.split(";");
  if (parts.some((part) => part.trim() === "")) {
    fail(`${path}: empty ${field} entry in ${row.package}@${row.version}`);
  }
  return filter ? parts.filter(filter).length : parts.length;
}

const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
const artifacts = [];
for (const a of doc.artifacts ?? []) {
  if (!NAME_RE.test(a.name)) fail(`versions.json: bad package name ${a.name}`);
  artifacts.push({ pkg: a.name, ver: a.version, wave: a.wave });
}
if (artifacts.length === 0) fail("versions.json pins no artifacts");
const pinned = new Map();
for (const a of artifacts) {
  if (!pinned.has(a.pkg)) pinned.set(a.pkg, new Set());
  pinned.get(a.pkg).add(a.ver);
}
const keyOf = (pkg, ver) => `${pkg}@${ver}`;
const waveOf = new Map(artifacts.map((a) => [keyOf(a.pkg, a.ver), a.wave]));

const seedsDoc = JSON.parse(readFileSync(SEEDS, "utf8"));
const frozenSeeds = seedsDoc.seeds ?? [];
if (frozenSeeds.length === 0) fail("hidden-seeds.json lists no seeds");
const publicSeed = String(seedsDoc.publicSeed ?? "");
if (!/^\d+$/.test(publicSeed)) fail("hidden-seeds.json lists no publicSeed");
const seedSet = new Set(frozenSeeds.map(String));

const auditRows = readCsv(AUDIT, AUDIT_HEADER);
const censusRows = readCsv(CENSUS, CENSUS_HEADER);
const overlapRows = readCsv(OVERLAP, OVERLAP_HEADER);

// Every pinned artifact appears exactly once in the audit and the
// census; duplicate, missing or unpinned rows fail by name.
const auditBy = new Map();
const censusBy = new Map();
for (const [rows, path, store] of [[auditRows, AUDIT, auditBy], [censusRows, CENSUS, censusBy]]) {
  for (const row of rows) {
    const key = keyOf(row.package, row.version);
    if (!pinned.get(row.package)?.has(row.version)) fail(`${path}: unpinned artifact ${key}`);
    if (store.has(key)) fail(`${path}: duplicate artifact ${key}`);
    if (Number(row.wave) !== waveOf.get(key)) fail(`${path}: ${key} wave disagrees with versions.json`);
    store.set(key, row);
  }
}
for (const a of artifacts) {
  const key = keyOf(a.pkg, a.ver);
  if (!auditBy.has(key)) fail(`tarball-audit.csv: missing artifact ${key}`);
  if (!censusBy.has(key)) fail(`hidden-census.csv: missing artifact ${key}`);
}

for (const row of auditBy.values()) {
  int(AUDIT, row, "files");
  int(AUDIT, row, "public_tasks");
  row.leaks = {
    hidden: listCount(AUDIT, row, "hidden_named_files"),
    answer: listCount(AUDIT, row, "answer_bearing_files"),
    seeds: listCount(AUDIT, row, "doc_hidden_seed_examples",
      (v) => v !== publicSeed && !YEAR_RE.test(v)),
  };
}
for (const [key, row] of censusBy) {
  if (!["yes", "no"].includes(row.qualifies)) fail(`hidden-census.csv: ${key} bad qualifies ${row.qualifies}`);
  censusBy.set(key, row.qualifies === "yes");
}

const qualified = artifacts.filter((a) => censusBy.get(keyOf(a.pkg, a.ver)));
if (qualified.length === 0) fail("hidden-census.csv: no artifact qualifies");

const overlapBy = new Map();
for (const row of overlapRows) {
  const key = keyOf(row.package, row.version);
  if (!pinned.get(row.package)?.has(row.version)) fail(`hidden-overlap.csv: unpinned artifact ${key}`);
  if (!censusBy.get(key)) fail(`hidden-overlap.csv: ${key} is not census-qualified`);
  if (!seedSet.has(row.seed)) fail(`hidden-overlap.csv: ${key} seed ${row.seed} is not frozen`);
  const cell = `${key}|${row.seed}`;
  if (overlapBy.has(cell)) fail(`hidden-overlap.csv: duplicate ${cell}`);
  const hidden = int(OVERLAP, row, "hidden_tasks");
  const publicN = int(OVERLAP, row, "public_tasks");
  const promptPairs = int(OVERLAP, row, "prompt_pairs");
  const expectedPairs = int(OVERLAP, row, "expected_pairs");
  const idDenom = Math.min(hidden, publicN);
  const share = (num, den, field) => {
    const n = int(OVERLAP, row, num);
    if (n > den || den === 0) fail(`hidden-overlap.csv: ${cell} ${field} ${n} vs denominator ${den}`);
    return (n / den) * 100;
  };
  overlapBy.set(cell, {
    prompt: share("prompt_exact_overlap", promptPairs, "prompt_exact_overlap"),
    expected: share("expected_exact_overlap", expectedPairs, "expected_exact_overlap"),
    idsuffix: share("id_suffix_overlap", idDenom, "id_suffix_overlap"),
  });
}
for (const a of qualified) {
  for (const s of frozenSeeds) {
    if (!overlapBy.has(`${keyOf(a.pkg, a.ver)}|${s}`)) fail(`hidden-overlap.csv: missing ${a.pkg}@${a.ver} seed ${s}`);
  }
}

const leakCells = [];
let leakMax = 0;
artifacts.forEach((a, y) => {
  const c = auditBy.get(keyOf(a.pkg, a.ver)).leaks;
  [c.hidden, c.answer, c.seeds].forEach((count, x) => {
    leakCells.push(`${x},${y},${count}`);
    leakMax = Math.max(leakMax, count);
  });
});

const overlapCells = [];
qualified.forEach((a, x) => {
  frozenSeeds.forEach((s, j) => {
    const o = overlapBy.get(`${keyOf(a.pkg, a.ver)}|${s}`);
    const xj = (x + (j - (frozenSeeds.length - 1) / 2) * JITTER).toFixed(3);
    overlapCells.push([x, s, xj, o.prompt.toFixed(1), o.expected.toFixed(1), o.idsuffix.toFixed(1)].join(","));
  });
});

const waveOneRows = artifacts.filter((a) => a.wave === 1).length;
const label = (a) => `${a.pkg.replace(/^benchmark-/, "")} ${a.ver}`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "hidden-audit-leaks.csv"), `x,y,count\n${leakCells.join("\n")}\n`);
writeFileSync(join(OUT_DIR, "hidden-audit-cols.csv"),
  `x,label\n${LEAK_COLS.map((c, i) => `${i},${c}`).join("\n")}\n`);
writeFileSync(join(OUT_DIR, "hidden-audit-rows.csv"),
  `y,label\n${artifacts.map((a, y) => `${y},${label(a)}`).join("\n")}\n`);
writeFileSync(join(OUT_DIR, "hidden-audit-overlap.csv"),
  `x,seed,xj,prompt,expected,idsuffix\n${overlapCells.join("\n")}\n`);
writeFileSync(join(OUT_DIR, "hidden-audit-qrows.csv"),
  `x,label\n${qualified.map((a, x) => `${x},${label(a)}`).join("\n")}\n`);
writeFileSync(join(OUT_DIR, "hidden-audit-macros.tex"), [
  "% Generated by scripts/exp/hidden-audit-plot.mjs. Do not edit.",
  `\\newcommand{\\auditCols}{${LEAK_COLS.length}}`,
  `\\newcommand{\\auditRows}{${artifacts.length}}`,
  `\\newcommand{\\auditWaveRows}{${waveOneRows}}`,
  `\\newcommand{\\auditQual}{${qualified.length}}`,
  `\\newcommand{\\auditQualMax}{${qualified.length - 1}}`,
  `\\newcommand{\\auditLeakMax}{${Math.max(1, leakMax)}}`,
  `\\newcommand{\\auditQualXMax}{${qualified.length - 0.5}}`,
  "",
].join("\n"));

console.log(`cells=${leakCells.length} rows=${artifacts.length} qualified=${qualified.length} seeds=${frozenSeeds.length} leakMax=${leakMax} -> hidden-audit outputs, ok`);
