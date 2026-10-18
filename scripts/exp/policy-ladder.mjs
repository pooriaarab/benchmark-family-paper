#!/usr/bin/env node
// F4 policy-tier ladder from the released-version data. Reads
// scripts/exp/versions.json, paper/data/exp/trivial-headroom.csv, the
// frozen exploit list and the part-a/b result files, and writes the
// figure inputs into paper/generated/:
//   policy-ladder-blind.csv      x,y: best of 8 blind policies (E1)
//   policy-ladder-taskaware.csv  x,y: best E2 attack row (or absent)
//   policy-ladder-oracle.csv     x,y: mock good mean at the version
//   policy-ladder-labels.csv     y,label per package row
//   policy-ladder-stems.tex      \draw segments + no-E2-row nodes
//   policy-ladder-macros.tex     row/tier counts for the .tex
// One row per package at its released version (highest pinned). The
// prompt-reading tier does not exist: E3 was not run. Part c
// measures pinned commits and never enters the figure. See
// policy-ladder.failure-modes.md.
//
//   node scripts/exp/policy-ladder.mjs            # write the outputs
//   node scripts/exp/policy-ladder.mjs --check    # fail on stale
//                                                 # generated files

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAttackRow, parseCsv, parseRecordValue } from "./exploits-clauses.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const HEADROOM = join(ROOT, "paper/data/exp/trivial-headroom.csv");
const FROZEN = join(ROOT, "paper/data/exp/exploits.csv");
const RESULTS = {
  a: join(ROOT, "paper/data/exp/exploit-results-a.csv"),
  b: join(ROOT, "paper/data/exp/exploit-results-b.csv"),
};
const OUT_DIR = join(ROOT, "paper/generated");
const AB_VERDICTS = new Set(["replicated", "not-replicated", "fix-holds", "fix-fails", "not-runnable"]);
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`policy-ladder: ${message}`);
  process.exit(1);
}

function readRows(path, header) {
  let rows;
  try {
    rows = parseCsv(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`${path}: ${err.message}`);
  }
  const head = Object.keys(rows[0] ?? {});
  if (JSON.stringify(head) !== JSON.stringify(header)) {
    fail(`${path}: header is ${head.join(",")}, expected ${header.join(",")}`);
  }
  return rows;
}

function score01(path, raw, what) {
  const m = Number(raw);
  if (!Number.isFinite(m) || m < 0 || m > 1) fail(`${path}: ${what} ${raw} outside [0,1]`);
  return m;
}

const HEADROOM_HEAD = ["package", "version", "oracle", "best_policy", "best_trivial", "headroom"];
const FROZEN_HEAD = ["package", "locator", "policy", "record_value", "record_quote", "value_kind", "measured_state", "versions", "reproducibility", "comparison", "scope", "why"];
const AB_HEAD = ["package", "locator", "row", "version", "clause", "tasks", "measured", "baseline", "record_value", "verdict", "detail"];

// Released version per package = highest pinned; row order follows
// versions.json, wave 1 first then wave 2.
const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
const waveOf = new Map();
const released = new Map();
const pinned = new Map();
const pkgOrder = [];
for (const a of doc.artifacts ?? []) {
  if (!NAME_RE.test(a.name)) fail(`versions.json: bad package name ${a.name}`);
  waveOf.set(a.name, a.wave);
  if (!pinned.has(a.name)) { pinned.set(a.name, new Set()); pkgOrder.push(a.name); }
  pinned.get(a.name).add(a.version);
  const prev = released.get(a.name);
  if (prev === undefined || a.version > prev) released.set(a.name, a.version);
}
if (pkgOrder.length === 0) fail("versions.json pins no artifacts");

// Blind and oracle tiers at the released version, one headroom row
// per pinned artifact.
const headroom = readRows(HEADROOM, HEADROOM_HEAD);
const headSeen = new Set();
const tiers = new Map(); // pkg -> {blind, oracle}
for (const row of headroom) {
  if (!pinned.has(row.package)) fail(`${HEADROOM}: ${row.package} is not a pinned package`);
  if (!pinned.get(row.package).has(row.version)) {
    fail(`${HEADROOM}: ${row.package}@${row.version} is not a pinned artifact`);
  }
  const key = `${row.package}@${row.version}`;
  if (headSeen.has(key)) fail(`${HEADROOM}: duplicate row for ${key}`);
  headSeen.add(key);
  if (row.version === released.get(row.package)) {
    tiers.set(row.package, {
      blind: score01(HEADROOM, row.best_trivial, "best_trivial"),
      oracle: score01(HEADROOM, row.oracle, "oracle"),
    });
  }
}
for (const pkg of pkgOrder) {
  if (!tiers.has(pkg)) fail(`${HEADROOM}: no row for released ${pkg}@${released.get(pkg)}`);
}

// Task-aware tier: the best E2 attack row at the released version.
// Honest-answer re-checks are not policies and never count; a frozen
// row the record-value rule cannot classify throws.
const frozenRows = readRows(FROZEN, FROZEN_HEAD);
const frozen = new Map();
frozenRows.forEach((row, index) => frozen.set(index + 2, row));
const taskAware = new Map(); // pkg -> best measured at released version
const pairSeen = new Set();
for (const part of ["a", "b"]) {
  for (const row of readRows(RESULTS[part], AB_HEAD)) {
    const line = Number(row.row);
    const ref = frozen.get(line);
    if (!ref) fail(`exploit-results-${part}.csv: no frozen row at line ${row.row}`);
    if (row.package !== ref.package || row.locator !== ref.locator) {
      fail(`exploit-results-${part}.csv: line ${line} package/locator mismatch with exploits.csv`);
    }
    if (!AB_VERDICTS.has(row.verdict)) {
      fail(`exploit-results-${part}.csv: line ${line} bad verdict ${row.verdict}`);
    }
    const pkgName = `benchmark-${row.package}`;
    if (!pinned.get(pkgName)?.has(row.version)) {
      fail(`exploit-results-${part}.csv: ${row.package}@${row.version} is not a pinned artifact`);
    }
    if (waveOf.get(pkgName) === 2 && row.version !== "0.1.0") {
      fail(`exploit-results-${part}.csv: wave-2 ${row.package} measured at ${row.version}`);
    }
    const pair = `${line}|${row.version}`;
    if (pairSeen.has(pair)) fail(`exploit-results-${part}.csv: duplicate measurement ${pair}`);
    pairSeen.add(pair);
    try {
      parseRecordValue(ref.record_value);
    } catch (err) {
      fail(`exploits.csv line ${line}: ${err.message}`);
    }
    if (row.measured === "" || row.version !== released.get(pkgName) || !isAttackRow(ref)) continue;
    const m = score01(`exploit-results-${part}.csv`, row.measured, "measured");
    taskAware.set(pkgName, Math.max(taskAware.get(pkgName) ?? -1, m));
  }
}

const ordered = [...pkgOrder].sort((p, q) => waveOf.get(p) - waveOf.get(q));
const waveOneRows = ordered.filter((pkg) => waveOf.get(pkg) === 1).length;

const ptsBlind = [];
const ptsTaskAware = [];
const ptsOracle = [];
const labels = [];
const stems = [];
const noData = [];
ordered.forEach((pkg, y) => {
  labels.push(`${y},${pkg.replace(/^benchmark-/, "")}`);
  const t = tiers.get(pkg);
  ptsBlind.push(`${t.blind},${y}`);
  ptsOracle.push(`${t.oracle},${y}`);
  const xs = [t.blind, t.oracle];
  const hasTa = taskAware.has(pkg);
  if (hasTa) {
    const ta = taskAware.get(pkg);
    ptsTaskAware.push(`${ta},${y}`);
    xs.push(ta);
  } else {
    noData.push(y);
  }
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi - lo > 1e-9) {
    stems.push(`\\draw[black!25] (axis cs:${lo},${y}) -- (axis cs:${hi},${y});`);
  }
  // The node comes after the stem so its white fill covers the line.
  if (!hasTa) {
    stems.push(`\\node[font=\\tiny, text=black!55, fill=white, inner sep=1pt] at (axis cs:0.5,${y}) {no E2 row};`);
  }
});
// Package boundaries as light rules every four rows would clutter;
// only the wave boundary is drawn, from \policyLadderWaveOneRows.

const macrosTex = `% Generated by scripts/exp/policy-ladder.mjs. Do not edit.
\\newcommand{\\policyLadderRows}{${ordered.length}}
\\newcommand{\\policyLadderWaveOneRows}{${waveOneRows}}
\\newcommand{\\policyLadderTaskAware}{${ptsTaskAware.length}}
\\newcommand{\\policyLadderNoData}{${noData.length}}
`;

const outputs = {
  "policy-ladder-blind.csv": `x,y\n${ptsBlind.join("\n")}\n`,
  "policy-ladder-taskaware.csv": `x,y\n${ptsTaskAware.join("\n")}\n`,
  "policy-ladder-oracle.csv": `x,y\n${ptsOracle.join("\n")}\n`,
  "policy-ladder-labels.csv": `y,label\n${labels.join("\n")}\n`,
  "policy-ladder-stems.tex": `% Generated by scripts/exp/policy-ladder.mjs. Do not edit.\n${stems.join("\n")}\n`,
  "policy-ladder-macros.tex": macrosTex,
};

if (process.argv.includes("--check")) {
  for (const [name, text] of Object.entries(outputs)) {
    const path = join(OUT_DIR, name);
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      fail(`${name} is stale; run node scripts/exp/policy-ladder.mjs`);
    }
  }
  console.log(`policy-ladder: ${ordered.length} rows, ${ptsTaskAware.length} task-aware, ${noData.length} no-data, generated files fresh`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of Object.entries(outputs)) {
    writeFileSync(join(OUT_DIR, name), text);
  }
  const digest = createHash("sha256").update(macrosTex).digest("hex").slice(0, 12);
  console.log(
    `rows=${ordered.length} (${waveOneRows} wave 1) task-aware=${ptsTaskAware.length} ` +
      `no-E2=${noData.length} -> ${OUT_DIR.slice(ROOT.length + 1)} (macros sha ${digest}), ok`,
  );
}
