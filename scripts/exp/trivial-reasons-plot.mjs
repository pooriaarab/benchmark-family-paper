#!/usr/bin/env node
// F6 stacked-bar projection: write paper/generated/trivial-reasons-plot.csv
// (one row per package: per-class share of its zero-score blind-policy
// rows, percent, pooled across the package's pinned versions) from
// paper/data/exp/trivial-reasons.csv. Row order follows
// paper/data/review-rounds.csv so the wave boundary matches figure F2.
// See scripts/exp/trivial-reasons-plot.failure-modes.md for the guards.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const CLASSES = join(ROOT, "scripts/exp/reason-classes.json");
const REASONS = join(ROOT, "paper/data/exp/trivial-reasons.csv");
const ROUNDS = join(ROOT, "paper/data/review-rounds.csv");
const OUT = join(ROOT, "paper/generated/trivial-reasons-plot.csv");
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const CLSCOLS = ["wrong", "contract", "formatgate", "abort", "unclassified"];
const CLSMAP = {
  "wrong-answer": "wrong",
  "contract-violation": "contract",
  "format-gate": "formatgate",
  "abort": "abort",
  "unclassified": "unclassified",
};

function fail(message) {
  console.error(`trivial-reasons-plot: ${message}`);
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

const pinned = new Map();
for (const a of JSON.parse(readFileSync(VERSIONS, "utf8")).artifacts ?? []) {
  if (!NAME_RE.test(a.name)) fail(`versions.json: bad package name ${a.name}`);
  if (!pinned.has(a.name)) pinned.set(a.name, new Set());
  pinned.get(a.name).add(a.version);
}
if (pinned.size === 0) fail("versions.json pins no artifacts");

const frozen = Object.keys(JSON.parse(readFileSync(CLASSES, "utf8")).classMeanings ?? {});
for (const cls of ["format-gate", "contract-violation", "wrong-answer", "abort"]) {
  if (!frozen.includes(cls)) fail(`reason-classes.json no longer declares ${cls}`);
}

// Zero-row counts pooled per package over its pinned versions.
const counts = new Map();
for (const row of readCsv(REASONS, ["package", "version", "class", "count"])) {
  if (!pinned.get(row.package)?.has(row.version)) {
    fail(`trivial-reasons.csv: unpinned artifact ${row.package}@${row.version}`);
  }
  const col = CLSMAP[row.class];
  if (!col) fail(`trivial-reasons.csv: class ${row.class} is not a frozen reason class`);
  const count = Number(row.count);
  if (!Number.isInteger(count) || count < 0) fail(`trivial-reasons.csv: bad count ${row.count}`);
  const id = row.package.replace(/^benchmark-/, "");
  if (!counts.has(id)) counts.set(id, Object.fromEntries(CLSCOLS.map((c) => [c, 0])));
  counts.get(id)[col] += count;
}

// Bar order follows review-rounds.csv (wave 1 first), like figure F2.
const order = [];
for (const row of readCsv(ROUNDS, ["id", "wave", "fix_rounds"])) {
  if (!NAME_RE.test(row.id)) fail(`review-rounds.csv: bad package id ${row.id}`);
  if (!pinned.has(`benchmark-${row.id}`)) fail(`review-rounds.csv: ${row.id} is not pinned`);
  order.push(row.id);
}
for (const id of counts.keys()) {
  if (!order.includes(id)) fail(`trivial-reasons.csv: ${id} has no review-rounds row`);
}

const lines = ["package," + CLSCOLS.join(",")];
let emptyBars = 0;
for (const id of order) {
  const c = counts.get(id) ?? Object.fromEntries(CLSCOLS.map((k) => [k, 0]));
  const total = CLSCOLS.reduce((s, k) => s + c[k], 0);
  if (total === 0) emptyBars += 1;
  const shares = CLSCOLS.map((k) => (total ? (c[k] / total) * 100 : 0));
  // Residual lands on the largest class so every bar reaches 100.
  const vals = shares.map((v) => Math.round(v * 10) / 10);
  if (total > 0) {
    const residual = 100 - vals.reduce((s, v) => s + v, 0);
    let biggest = 0;
    vals.forEach((v, i) => { if (v > vals[biggest]) biggest = i; });
    vals[biggest] = Math.round((vals[biggest] + residual) * 10) / 10;
  }
  const out = vals.map((v) => v.toFixed(1));
  lines.push(`${id},${out.join(",")}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log(`packages=${order.length} empty=${emptyBars} -> trivial-reasons-plot.csv, ok`);
