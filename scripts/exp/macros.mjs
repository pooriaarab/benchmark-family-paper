#!/usr/bin/env node
// Experiment macros: turn the committed experiment CSVs into
// paper/generated/exp-macros.tex so no number is ever typed into a
// .tex file. The released version per package is the highest version
// pinned in scripts/exp/versions.json (0.2.0 for wave 1, 0.1.0 for
// wave 2), so wave-2 packages land in the released-version macros.
//
//   node scripts/exp/macros.mjs           # regenerate the file
//   node scripts/exp/macros.mjs --check   # fail on stale output or on
//                                         # an \exp* macro used in any
//                                         # paper/*.tex but not defined
//
// See scripts/exp/macros.failure-modes.md for what each guard catches.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const CLASSES = join(ROOT, "scripts/exp/reason-classes.json");
const OUT = join(ROOT, "paper/generated/exp-macros.tex");
const PAPER = join(ROOT, "paper");
const REASON_CLASSES = ["format-gate", "contract-violation", "wrong-answer", "abort", "unclassified"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const SOURCES = [
  { key: "versions", path: VERSIONS, rel: "scripts/exp/versions.json" },
  { key: "classes", path: CLASSES, rel: "scripts/exp/reason-classes.json" },
  { key: "cells", path: join(ROOT, "paper/data/exp/trivial-battery-cells.csv"), rel: "paper/data/exp/trivial-battery-cells.csv" },
  { key: "headroom", path: join(ROOT, "paper/data/exp/trivial-headroom.csv"), rel: "paper/data/exp/trivial-headroom.csv" },
  { key: "reasons", path: join(ROOT, "paper/data/exp/trivial-reasons.csv"), rel: "paper/data/exp/trivial-reasons.csv" },
  { key: "seeds", path: join(ROOT, "scripts/exp/hidden-seeds.json"), rel: "scripts/exp/hidden-seeds.json" },
  { key: "tarballAudit", path: join(ROOT, "paper/data/exp/tarball-audit.csv"), rel: "paper/data/exp/tarball-audit.csv" },
  { key: "hiddenCensus", path: join(ROOT, "paper/data/exp/hidden-census.csv"), rel: "paper/data/exp/hidden-census.csv" },
  { key: "hiddenOverlap", path: join(ROOT, "paper/data/exp/hidden-overlap.csv"), rel: "paper/data/exp/hidden-overlap.csv" },
];

function fail(message) {
  console.error(`exp-macros: ${message}`);
  process.exit(1);
}

// Same convention as collect.mjs: the experiment aggregate CSVs carry
// no commas or quotes inside fields, so a split is the whole parser.
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

function num(path, row, field) {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) fail(`${path}: ${field} is not numeric in ${Object.values(row).join(",")}`);
  return value;
}

function fmt(value) {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}

function pct(part, whole) {
  return ((part / whole) * 100).toFixed(1);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const compareVersions = (a, b) => a.localeCompare(b, "en", { numeric: true });

// Package ids are NAME_RE-checked on load, so texttt needs no escaping.
function ttId(id) {
  return id
    .replace(/^benchmark-/, "")
    .split("-")
    .map((part) => `\\texttt{${part}}`)
    .join("-\\allowbreak");
}

function pkgList(ids) {
  const sorted = [...ids].sort();
  return sorted.length === 0 ? "\\emph{none}" : sorted.map(ttId).join(", ");
}

function loadInputs() {
  const versions = JSON.parse(readFileSync(VERSIONS, "utf8"));
  const pinned = new Map();
  const waveOf = new Map();
  const released = new Map();
  for (const artifact of versions.artifacts ?? []) {
    if (!NAME_RE.test(artifact.name)) fail(`versions.json: bad package name ${artifact.name}`);
    if (!pinned.has(artifact.name)) pinned.set(artifact.name, new Set());
    pinned.get(artifact.name).add(artifact.version);
    waveOf.set(artifact.name, artifact.wave);
    const prev = released.get(artifact.name);
    if (prev === undefined || compareVersions(artifact.version, prev) > 0) {
      released.set(artifact.name, artifact.version);
    }
  }
  if (pinned.size === 0) fail("versions.json pins no artifacts");

  const classes = JSON.parse(readFileSync(CLASSES, "utf8"));
  const declared = Object.keys(classes.classMeanings ?? {});
  for (const cls of REASON_CLASSES.slice(0, -1)) {
    if (!declared.includes(cls)) fail(`reason-classes.json no longer declares ${cls}`);
  }

  const cells = readCsv(SOURCES[2].path, ["package", "version", "policy", "mean", "rows", "tasks"]);
  const headroom = readCsv(SOURCES[3].path, ["package", "version", "oracle", "best_policy", "best_trivial", "headroom"]);
  const reasons = readCsv(SOURCES[4].path, ["package", "version", "class", "count"]);
  const seeds = JSON.parse(readFileSync(SOURCES[5].path, "utf8")).seeds ?? [];
  if (seeds.length === 0) fail("hidden-seeds.json lists no seeds");
  const audit = readCsv(SOURCES[6].path, ["package", "version", "wave", "files", "tasks_file", "public_tasks", "hidden_named_files", "answer_bearing_files", "doc_seeds", "doc_hidden_seed_examples"]);
  const census = readCsv(SOURCES[7].path, ["package", "version", "wave", "generator", "split_flag", "seed_flag", "output_flag", "hidden_default", "hidden_needs_seed", "tasks_flag", "qualifies"]);
  const overlap = readCsv(SOURCES[8].path, ["package", "version", "wave", "seed", "generator", "hidden_tasks", "public_tasks", "prompt_pairs", "prompt_exact_overlap", "prompt_norm_overlap", "expected_pairs", "expected_exact_overlap", "expected_norm_overlap", "id_exact_overlap", "id_suffix_overlap"]);
  return { versions, pinned, waveOf, released, cells, headroom, reasons, seeds, audit, census, overlap };
}

// A `;`-joined list where `none` means empty; an empty entry after a
// split is a formatting drift, never a count.
function listLen(rel, row, field) {
  const value = row[field].trim();
  if (value === "none") return 0;
  const parts = value.split(";");
  if (parts.some((part) => part.trim() === "")) {
    fail(`${rel}: empty ${field} entry in ${row.package}@${row.version}`);
  }
  return parts.length;
}

function analyse(input) {
  const { pinned, waveOf, released, cells, headroom, reasons, seeds, audit, census, overlap } = input;
  const artifacts = new Set();
  const policies = new Set();
  const seenCell = new Set();
  let failedCells = 0;
  let batteryRows = 0;
  for (const row of cells) {
    const versions = pinned.get(row.package);
    if (!versions || !versions.has(row.version)) {
      fail(`trivial-battery-cells.csv: unpinned artifact ${row.package}@${row.version}`);
    }
    artifacts.add(`${row.package}@${row.version}`);
    policies.add(row.policy);
    const key = `${row.package}|${row.version}|${row.policy}`;
    if (seenCell.has(key)) fail(`trivial-battery-cells.csv: duplicate cell ${key}`);
    seenCell.add(key);
    if (row.mean === "") {
      failedCells += 1;
    } else {
      const mean = num(SOURCES[2].rel, row, "mean");
      if (mean < 0 || mean > 1) fail(`trivial-battery-cells.csv: mean ${row.mean} outside [0,1]`);
    }
    batteryRows += num(SOURCES[2].rel, row, "rows");
  }

  const headByKey = new Map();
  for (const row of headroom) {
    if (!pinned.get(row.package)?.has(row.version)) {
      fail(`trivial-headroom.csv: unpinned artifact ${row.package}@${row.version}`);
    }
    const key = `${row.package}@${row.version}`;
    if (headByKey.has(key)) fail(`trivial-headroom.csv: duplicate row for ${key}`);
    if (row.best_trivial === "" || row.headroom === "" || row.oracle === "") {
      if (row.best_trivial !== "" || row.headroom !== "" || row.oracle === "") {
        fail(`trivial-headroom.csv: partial row for ${key}`);
      }
      headByKey.set(key, { key, pkg: row.package, ver: row.version, missing: true });
      continue;
    }
    const best = num(SOURCES[3].rel, row, "best_trivial");
    const oracle = num(SOURCES[3].rel, row, "oracle");
    const room = num(SOURCES[3].rel, row, "headroom");
    if (Math.abs(oracle - best - room) > 0.001) {
      fail(`trivial-headroom.csv: ${key} headroom ${row.headroom} != oracle - best`);
    }
    headByKey.set(key, { key, pkg: row.package, ver: row.version, best, oracle, headroom: room, bestPolicy: row.best_policy });
  }

  // A pinned artifact the battery never reached must not read as 0.
  const artifactIds = [...pinned].flatMap(([pkg, versions]) =>
    [...versions].map((ver) => `${pkg}@${ver}`));
  for (const key of artifactIds) {
    const [pkg, ver] = key.split("@");
    if (!headByKey.has(key)) fail(`trivial-headroom.csv has no row for pinned ${key}`);
    if (![...seenCell].some((cell) => cell.startsWith(`${pkg}|${ver}|`))) {
      fail(`trivial-battery-cells.csv has no cell for pinned ${key}`);
    }
  }

  const classCounts = Object.fromEntries(REASON_CLASSES.map((cls) => [cls, 0]));
  let zeroRows = 0;
  for (const row of reasons) {
    if (!pinned.get(row.package)?.has(row.version)) {
      fail(`trivial-reasons.csv: unpinned artifact ${row.package}@${row.version}`);
    }
    if (!Object.hasOwn(classCounts, row.class)) {
      fail(`trivial-reasons.csv: class ${row.class} is not a frozen reason class`);
    }
    const count = num(SOURCES[4].rel, row, "count");
    if (!Number.isInteger(count) || count < 0) fail(`trivial-reasons.csv: bad count ${row.count}`);
    classCounts[row.class] += count;
    zeroRows += count;
  }
  if (zeroRows === 0) fail("trivial-reasons.csv records no zero rows");

  // Tarball audit and hidden-split overlap (E5): every pinned artifact
  // appears exactly once in the audit and the census; overlap rows exist
  // only for census-qualified artifacts, one per frozen seed.
  const keyOf = (pkg, ver) => `${pkg}@${ver}`;
  const auditKeys = new Set();
  const censusKeys = new Set();
  const qualified = new Set();
  let leaksFound = 0;
  let seedExamples = 0;
  for (const row of audit) {
    const key = keyOf(row.package, row.version);
    if (!pinned.get(row.package)?.has(row.version)) fail(`tarball-audit.csv: unpinned artifact ${key}`);
    if (auditKeys.has(key)) fail(`tarball-audit.csv: duplicate artifact ${key}`);
    auditKeys.add(key);
    leaksFound += listLen(SOURCES[6].rel, row, "hidden_named_files")
      + listLen(SOURCES[6].rel, row, "answer_bearing_files");
    seedExamples += listLen(SOURCES[6].rel, row, "doc_hidden_seed_examples");
  }
  for (const row of census) {
    const key = keyOf(row.package, row.version);
    if (!pinned.get(row.package)?.has(row.version)) fail(`hidden-census.csv: unpinned artifact ${key}`);
    if (censusKeys.has(key)) fail(`hidden-census.csv: duplicate artifact ${key}`);
    censusKeys.add(key);
    if (!["yes", "no"].includes(row.qualifies)) fail(`hidden-census.csv: ${key} bad qualifies ${row.qualifies}`);
    if (row.qualifies === "yes") qualified.add(key);
  }
  for (const key of artifactIds) {
    if (!auditKeys.has(key)) fail(`tarball-audit.csv has no row for pinned ${key}`);
    if (!censusKeys.has(key)) fail(`hidden-census.csv has no row for pinned ${key}`);
  }
  if (qualified.size === 0) fail("hidden-census.csv: no artifact qualifies");

  const seedSet = new Set(seeds.map(String));
  const overlapCells = new Set();
  let maxPromptPct = 0;
  let maxExpectedPct = 0;
  let maxIdSuffixPct = 0;
  for (const row of overlap) {
    const key = keyOf(row.package, row.version);
    if (!qualified.has(key)) fail(`hidden-overlap.csv: ${key} is not census-qualified`);
    if (!seedSet.has(row.seed)) fail(`hidden-overlap.csv: ${key} seed ${row.seed} is not frozen`);
    const cell = `${key}|${row.seed}`;
    if (overlapCells.has(cell)) fail(`hidden-overlap.csv: duplicate ${cell}`);
    overlapCells.add(cell);
    const share = (field, den) => {
      const n = num(SOURCES[8].rel, row, field);
      if (!Number.isInteger(n) || n < 0 || n > den || den === 0) {
        fail(`hidden-overlap.csv: ${cell} ${field} ${row[field]} vs denominator ${den}`);
      }
      return (n / den) * 100;
    };
    const promptPairs = num(SOURCES[8].rel, row, "prompt_pairs");
    const expectedPairs = num(SOURCES[8].rel, row, "expected_pairs");
    const idDen = Math.min(num(SOURCES[8].rel, row, "hidden_tasks"), num(SOURCES[8].rel, row, "public_tasks"));
    maxPromptPct = Math.max(maxPromptPct, share("prompt_exact_overlap", promptPairs));
    maxExpectedPct = Math.max(maxExpectedPct, share("expected_exact_overlap", expectedPairs));
    maxIdSuffixPct = Math.max(maxIdSuffixPct, share("id_suffix_overlap", idDen));
  }
  for (const key of qualified) {
    for (const s of seedSet) {
      if (!overlapCells.has(`${key}|${s}`)) fail(`hidden-overlap.csv: missing ${key} seed ${s}`);
    }
  }

  const releasedRows = [];
  for (const [pkg, ver] of released) {
    const row = headByKey.get(`${pkg}@${ver}`);
    if (!row) fail(`no trivial-headroom.csv row for released ${pkg}@${ver}`);
    if (row.missing) fail(`released ${pkg}@${ver} has no measured best trivial score`);
    releasedRows.push(row);
  }
  const at = (pkg, ver) => headByKey.get(`${pkg}@${ver}`);
  const nonzero = (row) => row && !row.missing && row.best > 0;
  const bestAt = (pkg, ver) => {
    const row = at(pkg, ver);
    return row && !row.missing ? row.best : undefined;
  };
  const groupMax = (values, label) => {
    const measured = values.filter((value) => value !== undefined);
    if (measured.length === 0) fail(`${label}: no measured best trivial score`);
    return Math.max(0, ...measured);
  };
  const releasedBest = releasedRows.map((row) => row.best);
  const maxBest = Math.max(...releasedBest);
  const headrooms = releasedRows.map((row) => row.headroom);
  const wave1 = [...released].filter(([pkg]) => waveOf.get(pkg) === 1);
  const wave2 = [...released].filter(([pkg]) => waveOf.get(pkg) === 2);

  return {
    packages: pinned.size,
    artifacts: artifacts.size,
    wave1: wave1.length,
    wave2: wave2.length,
    policies: policies.size,
    cells: cells.length,
    failedCells,
    batteryRows,
    releasedMax: maxBest,
    releasedMaxPkgs: releasedRows.filter((row) => row.best === maxBest).map((row) => row.pkg),
    releasedZero: releasedRows.filter((row) => row.best === 0).length,
    releasedNonzeroPkgs: releasedRows.filter(nonzero).map((row) => row.pkg),
    wave1OldMax: groupMax(wave1.map(([pkg]) => bestAt(pkg, "0.1.0")), "wave1@0.1.0"),
    wave1NewMax: groupMax(wave1.map(([pkg]) => bestAt(pkg, "0.2.0")), "wave1@0.2.0"),
    wave2Max: groupMax(wave2.map(([pkg, ver]) => bestAt(pkg, ver)), "wave2 released"),
    wave1OldNonzero: wave1.filter(([pkg]) => nonzero(at(pkg, "0.1.0"))).length,
    wave1NewNonzero: wave1.filter(([pkg]) => nonzero(at(pkg, "0.2.0"))).length,
    wave2Nonzero: wave2.filter(([pkg, ver]) => nonzero(at(pkg, ver))).length,
    headroomMin: Math.min(...headrooms),
    headroomMedian: median(headrooms),
    headroomMax: Math.max(...headrooms),
    headroomBelowOne: headrooms.filter((h) => h < 1).length,
    oracleBelowOnePkgs: releasedRows.filter((row) => row.oracle < 1).map((row) => row.pkg),
    zeroRows,
    classCounts,
    auditArtifacts: auditKeys.size,
    auditLeaksFound: leaksFound,
    auditSeedExamples: seedExamples,
    auditCensusQualified: qualified.size,
    auditSeeds: seedSet.size,
    auditMaxPromptOverlapPct: maxPromptPct.toFixed(1),
    auditMaxExpectedOverlapPct: maxExpectedPct.toFixed(1),
    auditMaxIdSuffixPct: maxIdSuffixPct.toFixed(1),
  };
}

function generate(stats) {
  const lines = [
    "% Generated by scripts/exp/macros.mjs. Do not edit.",
    "% Sources (sha256, first 12 hex); --check fails when one moves.",
  ];
  for (const source of SOURCES) {
    const hash = createHash("sha256").update(readFileSync(source.path)).digest("hex").slice(0, 12);
    lines.push(`%   ${source.rel}: ${hash}`);
  }
  const c = stats.classCounts;
  lines.push(
    `\\newcommand{\\expPackages}{${stats.packages}}`,
    `\\newcommand{\\expArtifacts}{${stats.artifacts}}`,
    `\\newcommand{\\expWaveOne}{${stats.wave1}}`,
    `\\newcommand{\\expWaveTwo}{${stats.wave2}}`,
    `\\newcommand{\\expPolicies}{${stats.policies}}`,
    `\\newcommand{\\expCells}{${stats.cells}}`,
    `\\newcommand{\\expFailedCells}{${stats.failedCells}}`,
    `\\newcommand{\\expBatteryRows}{${stats.batteryRows}}`,
    `\\newcommand{\\expWaveOneOldMax}{${fmt(stats.wave1OldMax)}}`,
    `\\newcommand{\\expWaveOneNewMax}{${fmt(stats.wave1NewMax)}}`,
    `\\newcommand{\\expWaveTwoMax}{${fmt(stats.wave2Max)}}`,
    `\\newcommand{\\expTrivialReleasedMax}{${fmt(stats.releasedMax)}}`,
    `\\newcommand{\\expTrivialReleasedMaxPkgs}{${pkgList(stats.releasedMaxPkgs)}}`,
    `\\newcommand{\\expTrivialReleasedZero}{${stats.releasedZero}}`,
    `\\newcommand{\\expTrivialReleasedNonzero}{${stats.releasedNonzeroPkgs.length}}`,
    `\\newcommand{\\expTrivialReleasedNonzeroPkgs}{${pkgList(stats.releasedNonzeroPkgs)}}`,
    `\\newcommand{\\expWaveOneOldNonzero}{${stats.wave1OldNonzero}}`,
    `\\newcommand{\\expWaveOneNewNonzero}{${stats.wave1NewNonzero}}`,
    `\\newcommand{\\expWaveTwoNonzero}{${stats.wave2Nonzero}}`,
    `\\newcommand{\\expHeadroomMin}{${fmt(stats.headroomMin)}}`,
    `\\newcommand{\\expHeadroomMedian}{${fmt(stats.headroomMedian)}}`,
    `\\newcommand{\\expHeadroomMax}{${fmt(stats.headroomMax)}}`,
    `\\newcommand{\\expHeadroomBelowOne}{${stats.headroomBelowOne}}`,
    `\\newcommand{\\expOracleBelowOnePkgs}{${pkgList(stats.oracleBelowOnePkgs)}}`,
    `\\newcommand{\\expZeroRows}{${stats.zeroRows}}`,
    `\\newcommand{\\expClassFormatGate}{${c["format-gate"]}}`,
    `\\newcommand{\\expClassContractViolation}{${c["contract-violation"]}}`,
    `\\newcommand{\\expClassWrongAnswer}{${c["wrong-answer"]}}`,
    `\\newcommand{\\expClassAbort}{${c.abort}}`,
    `\\newcommand{\\expClassUnclassified}{${c.unclassified}}`,
    `\\newcommand{\\expFormatGateZeroPct}{${pct(c["format-gate"], stats.zeroRows)}}`,
    `\\newcommand{\\expFormatGateAllPct}{${pct(c["format-gate"], stats.batteryRows)}}`,
    `\\newcommand{\\expAuditArtifacts}{${stats.auditArtifacts}}`,
    `\\newcommand{\\expAuditLeaksFound}{${stats.auditLeaksFound}}`,
    `\\newcommand{\\expAuditSeedExamples}{${stats.auditSeedExamples}}`,
    `\\newcommand{\\expAuditCensusQualified}{${stats.auditCensusQualified}}`,
    `\\newcommand{\\expAuditSeeds}{${stats.auditSeeds}}`,
    `\\newcommand{\\expAuditMaxPromptOverlapPct}{${stats.auditMaxPromptOverlapPct}}`,
    `\\newcommand{\\expAuditMaxExpectedOverlapPct}{${stats.auditMaxExpectedOverlapPct}}`,
    `\\newcommand{\\expAuditMaxIdSuffixPct}{${stats.auditMaxIdSuffixPct}}`,
    "",
  );
  return `${lines.join("\n")}`;
}

function texFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "dmlr") continue; // fetched style tree, not paper source
      out.push(...texFiles(path));
    } else if (entry.endsWith(".tex")) {
      out.push(path);
    }
  }
  return out;
}

function check(expected) {
  if (!existsSync(OUT)) fail(`${OUT} does not exist; run node scripts/exp/macros.mjs`);
  if (readFileSync(OUT, "utf8") !== expected) {
    fail("paper/generated/exp-macros.tex is stale; run node scripts/exp/macros.mjs");
  }
  const defined = new Set(
    [...expected.matchAll(/\\newcommand\{\\(exp[A-Z][A-Za-z0-9]*)\}/g)].map((m) => m[1]),
  );
  const missing = new Map();
  for (const file of texFiles(PAPER)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\\exp[A-Z][A-Za-z0-9]*/g)) {
      const name = match[0].slice(1);
      if (!defined.has(name)) {
        if (!missing.has(name)) missing.set(name, []);
        missing.get(name).push(file.slice(ROOT.length + 1));
      }
    }
  }
  if (missing.size) {
    const detail = [...missing.entries()]
      .map(([name, files]) => `\\${name} in ${[...new Set(files)].join(", ")}`)
      .join("; ");
    fail(`used in text but not generated: ${detail}`);
  }
  return defined.size;
}

const input = loadInputs();
const stats = analyse(input);
const expected = generate(stats);

if (process.argv.includes("--check")) {
  const defined = check(expected);
  console.log(`exp-macros.mjs: ${defined} macros defined, all \\exp* uses covered, generated file fresh`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, expected);
  console.log(`packages=${stats.packages} artifacts=${stats.artifacts} cells=${stats.cells} failed=${stats.failedCells} rows=${stats.batteryRows}`);
  console.log(`released best-trivial max=${fmt(stats.releasedMax)} zero=${stats.releasedZero}/${stats.packages} headroom ${fmt(stats.headroomMin)}..${fmt(stats.headroomMax)} (median ${fmt(stats.headroomMedian)})`);
  console.log(`zero rows=${stats.zeroRows} format-gate=${stats.classCounts["format-gate"]} (${pct(stats.classCounts["format-gate"], stats.zeroRows)}% of zeros) -> ${OUT.slice(ROOT.length + 1)}, ok`);
}
