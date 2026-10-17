#!/usr/bin/env node
// F5 scatter projection: write the three figure CSVs into
// paper/generated/ from paper/data/exp/trivial-headroom.csv:
//   trivial-scatter.csv      wave-1 points (x = T(0.1.0), y = T(0.2.0))
//   trivial-scatter-rug.csv  wave-2, 0.1.0 only, drawn below the axis
//   trivial-scatter-notes.csv  per-point labels + the origin-cluster
//   count, so no count is typed into the .tex
// Wave-1 values are cross-checked against paper/data/trivial.csv: the
// figure shows the registered measurement, not a second opinion.
// See scripts/exp/trivial-scatter.failure-modes.md for the guards.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const HEADROOM = join(ROOT, "paper/data/exp/trivial-headroom.csv");
const TRIVIAL = join(ROOT, "paper/data/trivial.csv");
const OUT_DIR = join(ROOT, "paper/generated");
const TOLERANCE = 0.001;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`trivial-scatter: ${message}`);
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
    const row = {};
    header.forEach((name, index) => {
      row[name] = fields[index];
    });
    return row;
  });
}

const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
const waveOf = new Map();
const versionSet = new Map();
for (const a of doc.artifacts ?? []) {
  if (!NAME_RE.test(a.name)) fail(`versions.json: bad package name ${a.name}`);
  waveOf.set(a.name, a.wave);
  if (!versionSet.has(a.name)) versionSet.set(a.name, new Set());
  versionSet.get(a.name).add(a.version);
}
if (waveOf.size === 0) fail("versions.json pins no artifacts");

const head = new Map();
for (const row of readCsv(HEADROOM, ["package", "version", "oracle", "best_policy", "best_trivial", "headroom"])) {
  const known = versionSet.get(row.package);
  if (!known || !known.has(row.version)) {
    fail(`trivial-headroom.csv: unpinned artifact ${row.package}@${row.version}`);
  }
  if (row.best_trivial === "") fail(`trivial-headroom.csv: ${row.package}@${row.version} has no measured best`);
  const best = Number(row.best_trivial);
  if (!Number.isFinite(best) || best < 0 || best > 1) {
    fail(`trivial-headroom.csv: ${row.package}@${row.version} bad best ${row.best_trivial}`);
  }
  head.set(`${row.package}@${row.version}`, best);
}

// The registered record must agree with the E1 re-measurement on wave 1.
const registered = new Map();
for (const row of readCsv(TRIVIAL, ["package", "old", "new", "best_policy_old"])) {
  registered.set(row.package, { old: Number(row.old), new: Number(row.new) });
}

const shortId = (pkg) => pkg.replace(/^benchmark-/, "");
const fmt = (v) => v.toFixed(4);
const w1rows = [];
const w2rows = [];
for (const [pkg, versions] of versionSet) {
  const wave = waveOf.get(pkg);
  const old = head.get(`${pkg}@0.1.0`);
  if (old === undefined) fail(`trivial-headroom.csv: ${pkg}@0.1.0 missing`);
  if (wave === 1) {
    const nw = head.get(`${pkg}@0.2.0`);
    if (nw === undefined) fail(`trivial-headroom.csv: ${pkg}@0.2.0 missing`);
    const reg = registered.get(pkg);
    if (!reg) fail(`paper/data/trivial.csv: ${pkg} missing from the registered table`);
    if (Math.abs(reg.old - old) > TOLERANCE) {
      fail(`${pkg}@0.1.0: E1 best ${old} vs registered ${reg.old}`);
    }
    if (Math.abs(reg.new - nw) > TOLERANCE) {
      fail(`${pkg}@0.2.0: E1 best ${nw} vs registered ${reg.new}`);
    }
    w1rows.push({ pkg: shortId(pkg), x: old, y: nw });
  } else {
    w2rows.push({ pkg: shortId(pkg), x: old });
  }
}
if (w1rows.length === 0 || w2rows.length === 0) fail("a wave produced no rows");

// Labels live in data, never in the .tex: per-point names for nonzero
// points, one cluster label for the stacked zeros (they carry no
// per-dot text). Labels must not contain commas.
const notes = [];
for (const row of w1rows) {
  if (row.x !== 0 || row.y !== 0) notes.push({ x: row.x, y: row.y, label: row.pkg });
}
const w1zeros = w1rows.filter((row) => row.x === 0 && row.y === 0);
if (w1zeros.length) {
  notes.push({
    x: 0.0, y: 0.002,
    label: w1zeros.length === 1 ? "1 at origin" : `${w1zeros.length} at origin`,
  });
}
const w2zeros = w2rows.filter((row) => row.x === 0);
w2rows.forEach((row) => {
  row.label = row.x !== 0 ? row.pkg : "";
});
if (w2zeros.length) w2zeros[0].label = `${w2zeros.length} at 0 - 0.1.0 only`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "trivial-scatter.csv"), [
  "package,x,y",
  ...w1rows.map((row) => `${row.pkg},${fmt(row.x)},${fmt(row.y)}`),
].join("\n") + "\n");
writeFileSync(join(OUT_DIR, "trivial-scatter-rug.csv"), [
  "package,x,label",
  ...w2rows.map((row) => `${row.pkg},${fmt(row.x)},${row.label}`),
].join("\n") + "\n");
writeFileSync(join(OUT_DIR, "trivial-scatter-notes.csv"), [
  "x,y,label",
  ...notes.map((row) => `${fmt(row.x)},${fmt(row.y)},${row.label}`),
].join("\n") + "\n");

console.log(`wave1=${w1rows.length} wave2=${w2rows.length} notes=${notes.length} -> trivial-scatter csvs, ok`);
