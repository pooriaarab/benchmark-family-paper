#!/usr/bin/env node
// F7 probe heatmap projection: turn paper/data/exp/contract-probes.csv
// into the figure inputs under paper/generated/:
//   probe-heatmap.csv       one row per artifact x probe cell (x,y,state)
//   probe-heatmap-cols.csv  probe column labels, honest variants first
//   probe-heatmap-rows.csv  package@version row labels
//   probe-heatmap-fails.csv per-row fail counts for the margin bars
//   probe-heatmap-hatch.tex pattern fills for non-result cells
//   probe-heatmap-macros.tex axis bounds and group separators
// States: 0 outside-contract/not-runnable (white + hatch), 1 exploratory,
// 2 pass, 3 fail, 4 expected penalty (atk-dup-tool-calls fails, a
// documented zero on these graders; issue #213, M4).
// See scripts/exp/probe-heatmap.failure-modes.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const PROBES = join(ROOT, "scripts/exp/probes.json");
const CELLS = join(ROOT, "paper/data/exp/contract-probes.csv");
const OUT_DIR = join(ROOT, "paper/generated");
const HEADER = ["package", "version", "probe", "class", "result", "score", "reason", "outside_contract"];
const RESULTS = ["pass", "fail", "exploratory", "not-runnable", "outside-contract"];
const STATE = { "outside-contract": 0, "not-runnable": 0, exploratory: 1, pass: 2, fail: 3 };
// atk-dup-tool-calls fails are drawn apart: these graders score a
// repeated side effect zero on purpose, so the cell is a documented
// penalty rather than a defect (issue #213, M4).
const DESIGNED_PENALTY_PROBE = "atk-dup-tool-calls";
const KIND_ORDER = ["honest-variant", "unpromised-exploratory", "attack"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`probe-heatmap: ${message}`);
  process.exit(1);
}

// contract-probes.csv RFC-4180 quotes its reason column, so a plain
// split is not enough here.
function readCsv(path, header) {
  const text = readFileSync(path, "utf8");
  const rows = [];
  let field = "", row = [], inQuote = false;
  const push = () => { row.push(field); field = ""; };
  const pushRow = () => { push(); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuote = false;
      } else field += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ",") push();
    else if (ch === "\n") pushRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) pushRow();
  if (rows.length < 2) fail(`${path} has no data rows`);
  const head = rows.shift();
  if (JSON.stringify(head) !== JSON.stringify(header)) {
    fail(`${path}: header is ${head.join(",")}, expected ${header.join(",")}`);
  }
  return rows.map((fields) => {
    if (fields.length !== header.length) fail(`${path}: bad row ${fields.join(",")}`);
    return Object.fromEntries(header.map((name, index) => [name, fields[index]]));
  });
}

const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
const artifacts = [];
for (const a of doc.artifacts ?? []) {
  if (!NAME_RE.test(a.name)) fail(`versions.json: bad package name ${a.name}`);
  artifacts.push({ pkg: a.name, ver: a.version, wave: a.wave });
}
if (artifacts.length === 0) fail("versions.json pins no artifacts");
const pinned = new Set(artifacts.map((a) => `${a.pkg}@${a.ver}`));

const probesDoc = JSON.parse(readFileSync(PROBES, "utf8"));
const kindOf = new Map();
for (const p of probesDoc.probes ?? []) {
  if (!KIND_ORDER.includes(p.kind)) fail(`probes.json: ${p.id} has unknown kind ${p.kind}`);
  kindOf.set(p.id, p.kind);
}
// Columns: probes.json order within kind rank, honest variants first.
const cols = (probesDoc.probes ?? [])
  .map((p, i) => ({ id: p.id, kind: p.kind, i }))
  .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.i - b.i);
if (cols.length === 0) fail("probes.json lists no probes");
const colIndex = new Map(cols.map((c, i) => [c.id, i]));

const cells = readCsv(CELLS, HEADER);
const grid = new Map();
for (const row of cells) {
  const key = `${row.package}@${row.version}`;
  if (!pinned.has(key)) fail(`contract-probes.csv: unpinned artifact ${key}`);
  if (!kindOf.has(row.probe)) fail(`contract-probes.csv: unknown probe ${row.probe}`);
  if (row.class !== kindOf.get(row.probe)) {
    fail(`contract-probes.csv: ${key} ${row.probe} class ${row.class} != ${kindOf.get(row.probe)}`);
  }
  if (!RESULTS.includes(row.result)) fail(`contract-probes.csv: bad result ${row.result}`);
  if ((row.outside_contract === "yes") !== (row.result === "outside-contract")) {
    fail(`contract-probes.csv: ${key} ${row.probe} flag/result mismatch`);
  }
  if (row.score !== "" && !Number.isFinite(Number(row.score))) {
    fail(`contract-probes.csv: ${key} ${row.probe} bad score ${row.score}`);
  }
  const cellKey = `${key}|${row.probe}`;
  if (grid.has(cellKey)) fail(`contract-probes.csv: duplicate cell ${cellKey}`);
  grid.set(cellKey, row);
}
for (const a of artifacts) {
  for (const c of cols) {
    if (!grid.has(`${a.pkg}@${a.ver}|${c.id}`)) {
      fail(`contract-probes.csv: missing cell ${a.pkg}@${a.ver} ${c.id}`);
    }
  }
}

const matrix = [];
const hatch = [];
const fails = [];
artifacts.forEach((a, y) => {
  let failCount = 0;
  let designedCount = 0;
  cols.forEach((c, x) => {
    const row = grid.get(`${a.pkg}@${a.ver}|${c.id}`);
    const designed = row.result === "fail" && row.probe === DESIGNED_PENALTY_PROBE;
    matrix.push(`${x},${y},${designed ? 4 : STATE[row.result]}`);
    if (row.result === "fail") {
      if (designed) designedCount += 1;
      else failCount += 1;
    }
    if (row.result === "outside-contract" || row.result === "not-runnable") {
      const pattern = row.result === "outside-contract" ? "north east lines" : "crosshatch";
      hatch.push(`\\fill[pattern=${pattern}, pattern color=black!55] (axis cs:${x - 0.5},${y - 0.5}) rectangle (axis cs:${x + 0.5},${y + 0.5});`);
    }
    // Genuine fails get a pale diagonal overlay so they stay distinct
    // from pass cells when the figure prints in grayscale (issue #223, M7).
    if (row.result === "fail" && !designed) {
      hatch.push(`\\fill[pattern=north west lines, pattern color=white!80] (axis cs:${x - 0.5},${y - 0.5}) rectangle (axis cs:${x + 0.5},${y + 0.5});`);
    }
  });
  fails.push(`${y},${failCount},${designedCount}`);
});

const waveOneRows = artifacts.filter((a) => a.wave === 1).length;
const honestCols = cols.filter((c) => c.kind === "honest-variant").length;
const nonAttackCols = cols.filter((c) => c.kind !== "attack").length;
const failMax = Math.max(...fails.map((line) => Number(line.split(",")[1]) + Number(line.split(",")[2])));
const axisMax = Math.max(1, failMax + 1);
const tickMid = Math.floor(axisMax / 2);
const failTicks = tickMid === 0 || tickMid === axisMax ? `0,${axisMax}` : `0,${tickMid},${axisMax}`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "probe-heatmap.csv"), `x,y,state\n${matrix.join("\n")}\n`);
writeFileSync(join(OUT_DIR, "probe-heatmap-cols.csv"),
  `x,label\n${cols.map((c, i) => `${i},${c.id}`).join("\n")}\n`);
writeFileSync(join(OUT_DIR, "probe-heatmap-rows.csv"),
  `y,label\n${artifacts.map((a, y) => `${y},${a.pkg.replace(/^benchmark-/, "")} ${a.ver}`).join("\n")}\n`);
writeFileSync(join(OUT_DIR, "probe-heatmap-fails.csv"), `y,fails,designed\n${fails.join("\n")}\n`);
writeFileSync(join(OUT_DIR, "probe-heatmap-hatch.tex"),
  `% Generated by scripts/exp/probe-heatmap.mjs. Do not edit.\n${hatch.join("\n")}\n`);
writeFileSync(join(OUT_DIR, "probe-heatmap-macros.tex"), [
  "% Generated by scripts/exp/probe-heatmap.mjs. Do not edit.",
  `\\newcommand{\\probesCols}{${cols.length}}`,
  `\\newcommand{\\probesRows}{${artifacts.length}}`,
  `\\newcommand{\\probesWaveOneRows}{${waveOneRows}}`,
  `\\newcommand{\\probesHonestCols}{${honestCols}}`,
  `\\newcommand{\\probesNonAttackCols}{${nonAttackCols}}`,
  `\\newcommand{\\probesFailAxisMax}{${axisMax}}`,
  `\\newcommand{\\probesFailTicks}{${failTicks}}`,
  "",
].join("\n"));

const designedTotal = fails.reduce((s, line) => s + Number(line.split(",")[2]), 0);
console.log(`cells=${matrix.length} cols=${cols.length} rows=${artifacts.length} hatch=${hatch.length} failMax=${failMax} designed=${designedTotal} -> probe-heatmap outputs, ok`);
