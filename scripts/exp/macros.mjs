#!/usr/bin/env node
// Experiment macros: turn the committed experiment CSVs into
// paper/generated/exp-macros.tex so no number is ever typed into a
// .tex file. Also emits paper/generated/exploit-verdicts.tex, the T3
// float for the E2 re-measurement (verdict counts by run part and the
// list of every not-replicated and fix-fails clause). The released
// version per package is the highest version pinned in
// scripts/exp/versions.json (0.2.0 for wave 1, 0.1.0 for wave 2), so
// wave-2 packages land in the released-version macros.
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
import { isAttackRow, parseClauses, parseRecordValue } from "./exploits-clauses.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const CLASSES = join(ROOT, "scripts/exp/reason-classes.json");
const PROBES = join(ROOT, "scripts/exp/probes.json");
const OUT = join(ROOT, "paper/generated/exp-macros.tex");
const VERDICTS_OUT = join(ROOT, "paper/generated/exploit-verdicts.tex");
const POLICY_ONLY_OUT = join(ROOT, "paper/generated/exploit-policy-only.tex");
const PAPER = join(ROOT, "paper");
const REASON_CLASSES = ["format-gate", "contract-violation", "wrong-answer", "abort", "unclassified"];
const PROBE_RESULTS = ["pass", "fail", "exploratory", "not-runnable", "outside-contract"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const FORGED_RE = /^atk-forged-/;

const SOURCES = [
  { key: "versions", path: VERSIONS, rel: "scripts/exp/versions.json" },
  { key: "classes", path: CLASSES, rel: "scripts/exp/reason-classes.json" },
  { key: "probes", path: PROBES, rel: "scripts/exp/probes.json" },
  { key: "cells", path: join(ROOT, "paper/data/exp/trivial-battery-cells.csv"), rel: "paper/data/exp/trivial-battery-cells.csv" },
  { key: "headroom", path: join(ROOT, "paper/data/exp/trivial-headroom.csv"), rel: "paper/data/exp/trivial-headroom.csv" },
  { key: "reasons", path: join(ROOT, "paper/data/exp/trivial-reasons.csv"), rel: "paper/data/exp/trivial-reasons.csv" },
  { key: "contractProbes", path: join(ROOT, "paper/data/exp/contract-probes.csv"), rel: "paper/data/exp/contract-probes.csv" },
  { key: "seeds", path: join(ROOT, "scripts/exp/hidden-seeds.json"), rel: "scripts/exp/hidden-seeds.json" },
  { key: "tarballAudit", path: join(ROOT, "paper/data/exp/tarball-audit.csv"), rel: "paper/data/exp/tarball-audit.csv" },
  { key: "hiddenCensus", path: join(ROOT, "paper/data/exp/hidden-census.csv"), rel: "paper/data/exp/hidden-census.csv" },
  { key: "hiddenOverlap", path: join(ROOT, "paper/data/exp/hidden-overlap.csv"), rel: "paper/data/exp/hidden-overlap.csv" },
  { key: "detConfig", path: join(ROOT, "scripts/exp/determinism.json"), rel: "scripts/exp/determinism.json" },
  { key: "determinism", path: join(ROOT, "paper/data/exp/determinism.csv"), rel: "paper/data/exp/determinism.csv" },
  { key: "exploits", path: join(ROOT, "paper/data/exp/exploits.csv"), rel: "paper/data/exp/exploits.csv" },
  { key: "explA", path: join(ROOT, "paper/data/exp/exploit-results-a.csv"), rel: "paper/data/exp/exploit-results-a.csv" },
  { key: "explB", path: join(ROOT, "paper/data/exp/exploit-results-b.csv"), rel: "paper/data/exp/exploit-results-b.csv" },
  { key: "explC", path: join(ROOT, "paper/data/exp/exploit-results-c.csv"), rel: "paper/data/exp/exploit-results-c.csv" },
  { key: "runtimes", path: join(ROOT, "paper/data/exp/runtimes.csv"), rel: "paper/data/exp/runtimes.csv" },
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

// contract-probes.csv RFC-4180 quotes its reason column, so a plain
// split would misread it; this parser handles the quoted form.
function readQuotedCsv(path, header) {
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

// English list for short numeric grids: "2", "1 and 2", "1, 4 and 16".
function andList(items) {
  const list = items.map(String);
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// benchmark-checkout-consent -> CheckoutConsent, for per-cell macro names.
function camel(id) {
  return id
    .replace(/^benchmark-/, "")
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
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

  const probeIds = new Map();
  const probeType = new Map();
  const probesDoc = JSON.parse(readFileSync(PROBES, "utf8"));
  for (const p of probesDoc.probes ?? []) {
    probeIds.set(p.id, p.kind);
    if (p.kind === "attack") {
      if (!["A", "B"].includes(p.type)) {
        fail(`probes.json: attack probe ${p.id} carries no frozen TYPE A/B mark`);
      }
      probeType.set(p.id, p.type);
    }
  }
  if (probeIds.size === 0) fail("probes.json lists no probes");

  const cells = readCsv(SOURCES[3].path, ["package", "version", "policy", "mean", "rows", "tasks"]);
  const headroom = readCsv(SOURCES[4].path, ["package", "version", "oracle", "best_policy", "best_trivial", "headroom"]);
  const reasons = readCsv(SOURCES[5].path, ["package", "version", "class", "count"]);
  const contract = readQuotedCsv(SOURCES[6].path,
    ["package", "version", "probe", "class", "result", "score", "reason", "outside_contract"]);
  const seeds = JSON.parse(readFileSync(SOURCES[7].path, "utf8")).seeds ?? [];
  if (seeds.length === 0) fail("hidden-seeds.json lists no seeds");
  const audit = readCsv(SOURCES[8].path, ["package", "version", "wave", "files", "tasks_file", "public_tasks", "hidden_named_files", "answer_bearing_files", "doc_seeds", "doc_hidden_seed_examples"]);
  const census = readCsv(SOURCES[9].path, ["package", "version", "wave", "generator", "split_flag", "seed_flag", "output_flag", "hidden_default", "hidden_needs_seed", "tasks_flag", "qualifies"]);
  const overlap = readCsv(SOURCES[10].path, ["package", "version", "wave", "seed", "generator", "hidden_tasks", "public_tasks", "prompt_pairs", "prompt_exact_overlap", "prompt_norm_overlap", "expected_pairs", "expected_exact_overlap", "expected_norm_overlap", "id_exact_overlap", "id_suffix_overlap"]);
  const detConfig = JSON.parse(readFileSync(SOURCES[11].path, "utf8"));
  const determinism = readCsv(SOURCES[12].path,
    ["package", "version", "path", "seed", "concurrency", "repeat", "rows", "mean", "sha256", "status", "uniform", "node_version"]);
  const exploits = readQuotedCsv(SOURCES[13].path,
    ["package", "locator", "policy", "record_value", "record_quote", "value_kind", "measured_state", "versions", "reproducibility", "comparison", "scope", "why"]);
  const explA = readQuotedCsv(SOURCES[14].path,
    ["package", "locator", "row", "version", "clause", "tasks", "measured", "baseline", "record_value", "verdict", "detail"]);
  const explB = readQuotedCsv(SOURCES[15].path,
    ["package", "locator", "row", "version", "clause", "tasks", "measured", "baseline", "record_value", "verdict", "detail"]);
  const explC = readQuotedCsv(SOURCES[16].path,
    ["package", "locator", "measured_state", "record_value", "measured_value", "clause", "record_holds", "postfix_holds", "status", "notes"]);
  const runtimes = readCsv(SOURCES[17].path,
    ["experiment", "script", "artifacts", "cells", "wall_seconds", "measured_at"]);
  return { versions, pinned, waveOf, released, classes, cells, headroom, reasons, probeIds, probeType, contract, seeds, audit, census, overlap, detConfig, determinism, exploits, explA, explB, explC, runtimes };
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
  const { pinned, waveOf, released, classes, cells, headroom, reasons, probeIds, probeType, contract, seeds, audit, census, overlap, detConfig, determinism, exploits, explA, explB, explC, runtimes } = input;
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
      const mean = num(SOURCES[3].rel, row, "mean");
      if (mean < 0 || mean > 1) fail(`trivial-battery-cells.csv: mean ${row.mean} outside [0,1]`);
    }
    batteryRows += num(SOURCES[3].rel, row, "rows");
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
    const best = num(SOURCES[4].rel, row, "best_trivial");
    const oracle = num(SOURCES[4].rel, row, "oracle");
    const room = num(SOURCES[4].rel, row, "headroom");
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
  const pkgGate = new Map(); // package -> {atGate, total} zero rows over its pinned versions
  let zeroRows = 0;
  for (const row of reasons) {
    if (!pinned.get(row.package)?.has(row.version)) {
      fail(`trivial-reasons.csv: unpinned artifact ${row.package}@${row.version}`);
    }
    if (!Object.hasOwn(classCounts, row.class)) {
      fail(`trivial-reasons.csv: class ${row.class} is not a frozen reason class`);
    }
    const count = num(SOURCES[5].rel, row, "count");
    if (!Number.isInteger(count) || count < 0) fail(`trivial-reasons.csv: bad count ${row.count}`);
    classCounts[row.class] += count;
    zeroRows += count;
    const gate = pkgGate.get(row.package) ?? { atGate: 0, total: 0 };
    gate.total += count;
    if (row.class === "format-gate") gate.atGate += count;
    pkgGate.set(row.package, gate);
  }
  if (zeroRows === 0) fail("trivial-reasons.csv records no zero rows");

  // F6 prose guards: the packages whose every zero row dies at the
  // format gate, and the count of packages that never show a
  // format-gate row. A package absent from trivial-reasons.csv had no
  // zero row to classify and lands in neither set.
  const formatGateAllPkgs = [...pkgGate.entries()]
    .filter(([, gate]) => gate.total > 0 && gate.atGate === gate.total)
    .map(([pkg]) => pkg);
  const formatGateNone = [...pkgGate.values()].filter((gate) => gate.atGate === 0).length;

  // Tarball audit and hidden-split overlap (E5): every pinned artifact
  // appears exactly once in the audit and the census; overlap rows exist
  // only for census-qualified artifacts, one per frozen seed.
  const keyOf = (pkg, ver) => `${pkg}@${ver}`;
  const auditKeys = new Set();
  const censusKeys = new Set();
  const qualified = new Set();
  let leaksFound = 0;
  let seedExamples = 0;
  let seedlessQualified = 0;
  for (const row of audit) {
    const key = keyOf(row.package, row.version);
    if (!pinned.get(row.package)?.has(row.version)) fail(`tarball-audit.csv: unpinned artifact ${key}`);
    if (auditKeys.has(key)) fail(`tarball-audit.csv: duplicate artifact ${key}`);
    auditKeys.add(key);
    leaksFound += listLen(SOURCES[8].rel, row, "hidden_named_files")
      + listLen(SOURCES[8].rel, row, "answer_bearing_files");
    seedExamples += listLen(SOURCES[8].rel, row, "doc_hidden_seed_examples");
  }
  for (const row of census) {
    const key = keyOf(row.package, row.version);
    if (!pinned.get(row.package)?.has(row.version)) fail(`hidden-census.csv: unpinned artifact ${key}`);
    if (censusKeys.has(key)) fail(`hidden-census.csv: duplicate artifact ${key}`);
    censusKeys.add(key);
    if (!["yes", "no"].includes(row.qualifies)) fail(`hidden-census.csv: ${key} bad qualifies ${row.qualifies}`);
    if (row.qualifies === "yes" && row.hidden_needs_seed === "no") seedlessQualified += 1;
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
      const n = num(SOURCES[10].rel, row, field);
      if (!Number.isInteger(n) || n < 0 || n > den || den === 0) {
        fail(`hidden-overlap.csv: ${cell} ${field} ${row[field]} vs denominator ${den}`);
      }
      return (n / den) * 100;
    };
    const promptPairs = num(SOURCES[10].rel, row, "prompt_pairs");
    const expectedPairs = num(SOURCES[10].rel, row, "expected_pairs");
    const idDen = Math.min(num(SOURCES[10].rel, row, "hidden_tasks"), num(SOURCES[10].rel, row, "public_tasks"));
    maxPromptPct = Math.max(maxPromptPct, share("prompt_exact_overlap", promptPairs));
    maxExpectedPct = Math.max(maxExpectedPct, share("expected_exact_overlap", expectedPairs));
    maxIdSuffixPct = Math.max(maxIdSuffixPct, share("id_suffix_overlap", idDen));
  }
  for (const key of qualified) {
    for (const s of seedSet) {
      if (!overlapCells.has(`${key}|${s}`)) fail(`hidden-overlap.csv: missing ${key} seed ${s}`);
    }
  }

  // E6 determinism: one row per run of the matrix frozen in
  // scripts/exp/determinism.json, every artifact at its released pin.
  // A package counts byte-identical when every mock row reports
  // uniform=yes; any uniform=no row names a drifter.
  const detArtifacts = new Set(detConfig.artifacts ?? []);
  if (detArtifacts.size === 0) fail("determinism.json lists no artifacts");
  const detMockSeeds = [...new Set((detConfig.mockArm?.seeds ?? []).map(String))].sort(compareVersions);
  const detMockConc = [...new Set((detConfig.mockArm?.concurrency ?? []).map(String))]
    .sort((a, b) => Number(a) - Number(b));
  const detMockRepeats = Number(detConfig.mockArm?.repeats);
  const detTrivRepeats = Number(detConfig.trivialServerArm?.repeats);
  if (!detMockSeeds.length || !detMockConc.length) fail("determinism.json: mock arm lost its grid");
  if (!Number.isInteger(detMockRepeats) || detMockRepeats < 1) fail("determinism.json: bad mock repeats");
  if (!Number.isInteger(detTrivRepeats) || detTrivRepeats < 1) fail("determinism.json: bad trivial repeats");
  const detSeen = new Set();
  const detGroups = new Map(); // pkg -> Map(group -> Set(repeat))
  const detDrift = new Map(); // pkg -> Set(path)
  let detMockRuns = 0;
  let detTrivialRuns = 0;
  let detFailedRuns = 0;
  const detSeedsSeen = new Set();
  const detConcSeen = new Set();
  for (const row of determinism) {
    const key = keyOf(row.package, row.version);
    if (!detArtifacts.has(key)) fail(`determinism.csv: ${key} is not in the frozen matrix`);
    if (released.get(row.package) !== row.version) {
      fail(`determinism.csv: ${key} is not the released pin`);
    }
    if (!["mock", "trivial-server"].includes(row.path)) {
      fail(`determinism.csv: ${key} bad path ${row.path}`);
    }
    if (!["ok", "ok-after-retry", "timeout", "failed"].includes(row.status)) {
      fail(`determinism.csv: ${key} bad status ${row.status}`);
    }
    if (!["yes", "no"].includes(row.uniform)) fail(`determinism.csv: ${key} bad uniform ${row.uniform}`);
    const okRun = row.status === "ok" || row.status === "ok-after-retry";
    if (okRun !== (row.sha256 !== "")) fail(`determinism.csv: ${key} sha256 and status disagree`);
    if (!okRun) detFailedRuns += 1;
    const cell = `${key}|${row.path}|${row.seed}|${row.concurrency}|${row.repeat}`;
    if (detSeen.has(cell)) fail(`determinism.csv: duplicate run ${cell}`);
    detSeen.add(cell);
    if (row.path === "mock") {
      detMockRuns += 1;
      detSeedsSeen.add(row.seed);
      detConcSeen.add(row.concurrency);
    } else {
      detTrivialRuns += 1;
    }
    if (!detGroups.has(row.package)) detGroups.set(row.package, new Map());
    const groups = detGroups.get(row.package);
    const group = `${row.path}|${row.seed}|${row.concurrency}`;
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group).add(row.repeat);
    if (row.uniform === "no") {
      if (!detDrift.has(row.package)) detDrift.set(row.package, new Set());
      detDrift.get(row.package).add(row.path);
    }
  }
  // The measured grid must equal the frozen one: every artifact runs
  // every (seed, concurrency) mock cell repeats times and one
  // trivial-server group repeats times.
  if (detSeedsSeen.size !== detMockSeeds.length || detConcSeen.size !== detMockConc.length) {
    fail("determinism.csv: measured grid does not match the frozen matrix");
  }
  for (const key of detArtifacts) {
    const [pkg] = key.split("@");
    const groups = detGroups.get(pkg);
    if (!groups) fail(`determinism.csv: no runs for ${key}`);
    for (const s of detMockSeeds) {
      for (const c of detMockConc) {
        const reps = groups.get(`mock|${s}|${c}`);
        if (!reps || reps.size !== detMockRepeats) {
          fail(`determinism.csv: ${key} mock seed ${s} concurrency ${c} lacks its repeats`);
        }
      }
    }
    const trivKey = `trivial-server|${detConfig.trivialServerArm?.seed}|${detConfig.trivialServerArm?.concurrency}`;
    const triv = groups.get(trivKey);
    if (!triv || triv.size !== detTrivRepeats) {
      fail(`determinism.csv: ${key} trivial-server group lacks its repeats`);
    }
  }
  if (detGroups.size !== detArtifacts.size) fail("determinism.csv: unpinned package ran");
  const detDriftPkgs = [...detDrift.keys()].sort();
  const detIdentical = [...detArtifacts].filter((key) => {
    return !detDrift.has(key.split("@")[0]);
  }).length;

  // E2 exploit re-measurement: the frozen list keyed by its 1-based
  // line number is what the a/b `row` column cites; each result row
  // must join back to it on package and locator. Part c joins on
  // package + locator + measured_state because it has no `row` field.
  const VERDICTS = ["replicated", "not-replicated", "fix-holds", "fix-fails", "not-runnable"];
  const REPRO_CLASSES = new Set([
    "re-measurable-before-and-after",
    "re-measurable-after-only",
    "needs-source-checkout",
    "needs-reviewer-policy",
  ]);
  const frozen = new Map();
  exploits.forEach((row, index) => {
    const line = index + 2;
    if (!REPRO_CLASSES.has(row.reproducibility)) {
      fail(`exploits.csv line ${line}: bad reproducibility ${row.reproducibility}`);
    }
    frozen.set(line, row);
  });
  // One result clause is one (target, relation) pair; the T3 vs
  // column prints the bound or reference the relation compares
  // against, short so the table stays narrow.
  const clauseRel = (clause, rel) => {
    const parsed = parseClauses(clause);
    if (parsed.length !== 1 || parsed[0].target === null) {
      fail(`${rel}: cannot parse clause ${clause}`);
    }
    return parsed[0].rel;
  };
  const relVs = (rel, where) => {
    const m = rel.match(/^(?:equals|below|<=|within [\d.]+ of)\s*(.*)$/);
    if (!m) fail(`${where}: cannot shorten clause relation ${rel}`);
    return m[1].replace(/^approximate$/, "approx. record");
  };
  const explCounts = { a: {}, b: {}, c: {} };
  for (const part of ["a", "b", "c"]) {
    for (const v of VERDICTS) explCounts[part][v] = 0;
  }
  const explRowsRun = new Set();
  const explPair = new Set();
  const explLinesAB = new Set(); // distinct frozen lines parts a/b ran (tarballs)
  const atkOld = []; // wave-1 attack means at 0.1.0
  const atkNew = []; // wave-1 attack means at 0.2.0
  const atkByLine = new Map(); // wave-1 attack line -> {old, new}
  const atkRel = []; // attack means at the released version, both waves
  const atkW2Rel = [];
  const fixFailPkgs = new Set();
  const fixFailAttackPkgs = new Set();
  const fixFailHonestPkgs = new Set();
  const explBadRows = [];
  let explFixHoldsWeak = 0; // fix-holds whose only bound is "below 0.1.0"
  for (const [part, rows] of [["a", explA], ["b", explB]]) {
    for (const row of rows) {
      const line = Number(row.row);
      const ref = frozen.get(line);
      if (!ref) fail(`exploit-results-${part}.csv: no frozen row at line ${row.row}`);
      if (row.package !== ref.package || row.locator !== ref.locator) {
        fail(`exploit-results-${part}.csv: line ${line} package/locator mismatch with exploits.csv`);
      }
      if (!VERDICTS.includes(row.verdict)) {
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
      if (explPair.has(pair)) fail(`exploit-results-${part}.csv: duplicate measurement ${pair}`);
      explPair.add(pair);
      explRowsRun.add(line);
      explLinesAB.add(line);
      explCounts[part][row.verdict] += 1;
      const attack = isAttackRow(ref);
      const rel = ["fix-holds", "fix-fails", "not-replicated"].includes(row.verdict)
        ? clauseRel(row.clause, `exploit-results-${part}.csv`)
        : "";
      if (row.verdict === "fix-fails") {
        fixFailPkgs.add(row.package);
        (attack ? fixFailAttackPkgs : fixFailHonestPkgs).add(row.package);
      }
      if (row.verdict === "fix-holds" && rel === "below 0.1.0") explFixHoldsWeak += 1;
      if (row.verdict === "not-replicated" || row.verdict === "fix-fails") {
        explBadRows.push({ row: line, pkg: row.package, locator: row.locator, where: row.version, verdict: row.verdict, attack, rel, vs: relVs(rel, `exploit-results-${part}.csv`), measured: row.measured, record: row.record_value });
      }
      if (row.measured !== "") {
        const m = num(`exploit-results-${part}.csv`, row, "measured");
        if (m < 0 || m > 1) fail(`exploit-results-${part}.csv: line ${line} measured ${m} outside [0,1]`);
        if (attack) {
          if (waveOf.get(pkgName) === 1) {
            if (!atkByLine.has(line)) atkByLine.set(line, {});
            if (row.version === "0.1.0") { atkOld.push(m); atkByLine.get(line).old = m; }
            if (row.version === "0.2.0") { atkNew.push(m); atkByLine.get(line).new = m; }
          } else {
            atkW2Rel.push(m);
          }
          if (row.version === released.get(pkgName)) atkRel.push(m);
        }
      }
    }
  }
  // Frozen rows can share package, locator and commit (the six
  // crm-truthfulness issue-9 rows do), so part c joins on a queue
  // keyed by record_value too: each result row consumes one frozen
  // row of its key and fails when none is left. Two result rows may
  // be byte-identical (the two record-1.0 crm rows are); that is real
  // data, not a duplicate.
  const cQueue = new Map();
  for (const [line, ref] of frozen) {
    const key = `${ref.package}|${ref.locator}|${ref.measured_state}|${ref.record_value}`;
    if (!cQueue.has(key)) cQueue.set(key, []);
    cQueue.get(key).push(line);
  }
  // The text must not call every part-c row a published-artifact
  // measurement: only a "… tarball" measured_state is a released
  // artifact; an intermediate commit is unreleased source.
  const cCommitLines = new Set(); // frozen lines measured on intermediate commits
  const cTarballLines = new Set(); // frozen lines measured at a released tarball state
  let replCommit = 0;
  let notReplCommit = 0;
  let replTarball = 0;
  let notReplTarball = 0;
  for (const row of explC) {
    if (!["replicated", "not-replicated", "not-runnable"].includes(row.status)) {
      fail(`exploit-results-c.csv: bad status ${row.status}`);
    }
    if (row.postfix_holds !== "n/a") {
      fail(`exploit-results-c.csv: postfix_holds ${row.postfix_holds} must be n/a`);
    }
    const key = `${row.package}|${row.locator}|${row.measured_state}|${row.record_value}`;
    const queue = cQueue.get(key) ?? [];
    if (queue.length === 0) fail(`exploit-results-c.csv: no frozen row for ${row.package} record ${row.record_value}`);
    const cLine = queue.shift();
    explRowsRun.add(cLine);
    explCounts.c[row.status] += 1;
    const onCommit = row.measured_state.startsWith("intermediate commit ");
    const onTarball = row.measured_state.endsWith(" tarball");
    if (!onCommit && !onTarball) {
      fail(`exploit-results-c.csv: unrecognised measured_state ${row.measured_state}`);
    }
    (onCommit ? cCommitLines : cTarballLines).add(cLine);
    if (row.status === "replicated") {
      if (onCommit) replCommit += 1; else replTarball += 1;
    }
    if (row.status === "not-replicated") {
      if (onCommit) notReplCommit += 1; else notReplTarball += 1;
    }
    if (row.status !== "replicated") {
      const cRel = row.clause === "" ? "" : clauseRel(row.clause, "exploit-results-c.csv");
      explBadRows.push({ row: cLine, pkg: row.package, locator: row.locator, where: onCommit ? "commit" : row.measured_state, verdict: row.status, attack: isAttackRow(frozen.get(cLine)), rel: cRel, vs: cRel === "" ? "" : relVs(cRel, "exploit-results-c.csv"), measured: row.measured_value, record: row.record_value });
    }
  }
  // Every frozen row either ran (a/b/c) or is a needs-reviewer-policy
  // row that never could: count the second group, fail on anything else.
  const explPolicyOnly = exploits.filter(
    (row, index) => !explRowsRun.has(index + 2) && row.reproducibility === "needs-reviewer-policy",
  ).length;
  const explUnaccounted = exploits.filter(
    (row, index) => !explRowsRun.has(index + 2) && row.reproducibility !== "needs-reviewer-policy",
  );
  if (explUnaccounted.length) {
    fail(`exploits.csv: ${explUnaccounted.length} runnable rows produced no result rows`);
  }
  const explTotals = {};
  for (const v of VERDICTS) explTotals[v] = explCounts.a[v] + explCounts.b[v] + explCounts.c[v];
  const explClauses = explA.length + explB.length + explC.length;
  const explRecordClauses = explTotals.replicated + explTotals["not-replicated"];
  const explPostfixClauses = explTotals["fix-holds"] + explTotals["fix-fails"];
  const explAtkRows = new Set(
    [...explPair].map((pair) => Number(pair.split("|")[0])).filter((line) => isAttackRow(frozen.get(line))),
  ).size;
  explBadRows.sort((p, q) => p.row - q.row);

  // The two attack medians pair only where a wave-1 attack row carries
  // both versions: a row measured on one side alone stays outside.
  const atkPairs = [...atkByLine.values()].filter((d) => d.old !== undefined && d.new !== undefined);
  const explAtkNewOnly = [...atkByLine.values()].filter((d) => d.old === undefined && d.new !== undefined).length;
  const explAtkOldOnly = [...atkByLine.values()].filter((d) => d.new === undefined && d.old !== undefined).length;

  // The miss list the text cites: each not-replicated clause as
  // "package r<n> (<measured> against <record>)", every number out of
  // the result CSVs.
  const missRecord = (s) => s.replace(/%/g, "\\%").replace(/^~/, "about ");
  const explNotReplicatedList = andList(
    explBadRows
      .filter((r) => r.verdict === "not-replicated")
      .map((r) => `${ttId(r.pkg)} r${r.row} (${r.measured} against ${missRecord(r.record)})`),
  );

  // Row-level artifact split: parts a and b ran on the released
  // tarballs; part c split above. The two must account for every
  // frozen row that ran.
  const explReleasedRows = new Set([...explLinesAB, ...cTarballLines]).size;
  const explCommitRows = cCommitLines.size;
  if (explReleasedRows + explCommitRows !== explRowsRun.size) {
    fail(`artifact split ${explReleasedRows}+${explCommitRows} != ${explRowsRun.size} run rows`);
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
  // Contract probes (E4): one row per artifact x probe. A promised
  // honest variant is class honest-variant with result pass or fail;
  // exploratory and outside-contract cells never count either way.
  const probeSeen = new Set();
  const probeStats = new Map(); // artifact key -> {hvPromised, hvFail, forgedFail, fails, creditFail, movedFail}
  let probesOutsideContract = 0;
  let probesNotRunnable = 0;
  let probesReleasedCells = 0;
  for (const row of contract) {
    const key = keyOf(row.package, row.version);
    if (!pinned.get(row.package)?.has(row.version)) {
      fail(`contract-probes.csv: unpinned artifact ${key}`);
    }
    if (!probeIds.has(row.probe)) {
      fail(`contract-probes.csv: probe ${row.probe} is not in the frozen list`);
    }
    if (row.class !== probeIds.get(row.probe)) {
      fail(`contract-probes.csv: ${key} ${row.probe} class ${row.class} != frozen kind`);
    }
    if (!PROBE_RESULTS.includes(row.result)) {
      fail(`contract-probes.csv: ${key} ${row.probe} bad result ${row.result}`);
    }
    if ((row.outside_contract === "yes") !== (row.result === "outside-contract")) {
      fail(`contract-probes.csv: ${key} ${row.probe} outside_contract flag disagrees with result`);
    }
    if (row.result === "outside-contract") probesOutsideContract += 1;
    if (row.result === "not-runnable") probesNotRunnable += 1;
    if (row.version === released.get(row.package)) probesReleasedCells += 1;
    const cellKey = `${key}|${row.probe}`;
    if (probeSeen.has(cellKey)) fail(`contract-probes.csv: duplicate cell ${cellKey}`);
    probeSeen.add(cellKey);
    if (!probeStats.has(key)) {
      probeStats.set(key, { hvPromised: 0, hvFail: 0, forgedFail: 0, fails: 0, creditFail: 0, movedFail: 0, dupFail: 0, wrapFail: 0 });
    }
    const stat = probeStats.get(key);
    if (row.result === "fail") {
      stat.fails += 1;
      const type = probeType.get(row.probe);
      if (type === "A") stat.creditFail += 1;
      else if (type === "B") {
        stat.movedFail += 1;
        // The duplicate-call penalty is documented behaviour on these
        // graders (issue #213, M4); the text wraps are real defects.
        if (row.probe === "atk-dup-tool-calls") stat.dupFail += 1;
        else if (row.probe === "atk-prompt-echo" || row.probe === "atk-score-injection") {
          stat.wrapFail += 1;
        }
      }
      else if (row.class === "attack") fail(`contract-probes.csv: ${cellKey} failed under ${row.probe} which is no frozen attack type`);
    }
    if (row.class === "honest-variant" && (row.result === "pass" || row.result === "fail")) {
      stat.hvPromised += 1;
      if (row.result === "fail") stat.hvFail += 1;
    }
    if (FORGED_RE.test(row.probe) && row.result === "fail") stat.forgedFail += 1;
  }
  for (const [pkg, versions] of pinned) {
    for (const ver of versions) {
      for (const id of probeIds.keys()) {
        if (!probeSeen.has(`${pkg}@${ver}|${id}`)) {
          fail(`contract-probes.csv: missing cell ${pkg}@${ver} ${id}`);
        }
      }
    }
  }

  // Released-version probes: honest acceptance counts a released grader
  // that failed none of its promised honest variants (graders with no
  // promise reject nothing); forged acceptance counts one where any
  // forged-field attack broke its frozen rule.
  let probesHonestAccepted = 0;
  let probesHonestPromised = 0;
  let probesHonestCells = 0;
  let probesHonestHeld = 0;
  let probesFailedCells = 0;
  let probesCreditFailCells = 0;
  let probesMovedFailCells = 0;
  let probesDupCallCells = 0;
  let probesWrapCells = 0;
  const forgedAcceptedPkgs = [];
  const creditFailPkgs = [];
  const movedFailPkgs = [];
  const dupCallPkgs = [];
  const wrapPkgs = [];
  for (const [pkg, ver] of released) {
    const stat = probeStats.get(keyOf(pkg, ver));
    if (stat.hvFail === 0) probesHonestAccepted += 1;
    if (stat.hvPromised > 0) probesHonestPromised += 1;
    probesHonestCells += stat.hvPromised;
    probesHonestHeld += stat.hvPromised - stat.hvFail;
    probesFailedCells += stat.fails;
    probesCreditFailCells += stat.creditFail;
    probesMovedFailCells += stat.movedFail;
    probesDupCallCells += stat.dupFail;
    probesWrapCells += stat.wrapFail;
    if (stat.forgedFail > 0) forgedAcceptedPkgs.push(pkg);
    if (stat.creditFail > 0) creditFailPkgs.push(pkg);
    if (stat.movedFail > 0) movedFailPkgs.push(pkg);
    if (stat.dupFail > 0) dupCallPkgs.push(pkg);
    if (stat.wrapFail > 0) wrapPkgs.push(pkg);
  }
  // The type-B split must name every moved-fail cell: the designed
  // duplicate-call penalties plus the text wraps (issue #213, M4). A
  // nonzero remainder means a third kind the text does not cover.
  const probesMovedOtherCells = probesMovedFailCells - probesDupCallCells - probesWrapCells;
  if (probesMovedOtherCells !== 0) {
    fail(`type-B split ${probesDupCallCells}+${probesWrapCells} leaves ${probesMovedOtherCells} unnamed moved fails`);
  }
  const probesHonestUnpromised = released.size - probesHonestPromised;

  // Frozen-list shapes for Appendix J: declared reason classes and
  // their regex-rule count, probe counts by kind, and the frozen
  // exploit rows no run could reach (the reviewer's unreleased
  // policies), each with its line number for the r<n> citation.
  const reasonClassCount = Object.keys(classes.classMeanings ?? {}).length;
  const reasonClassRules =
    (classes.shared ?? []).length +
    Object.values(classes.packages ?? {}).reduce((sum, rules) => sum + rules.length, 0);
  const reasonClassPkgs = Object.keys(classes.packages ?? {}).length;
  let probesHonest = 0;
  let probesAttack = 0;
  let probesExploratory = 0;
  for (const kind of probeIds.values()) {
    if (kind === "honest-variant") probesHonest += 1;
    else if (kind === "attack") probesAttack += 1;
    else probesExploratory += 1;
  }
  const policyOnlyRows = exploits
    .map((row, index) => ({ row, line: index + 2 }))
    .filter(({ row }) => row.reproducibility === "needs-reviewer-policy");
  if (policyOnlyRows.length !== explPolicyOnly) {
    fail("needs-reviewer-policy rows disagree with the unrun-row count");
  }

  const releasedBest = releasedRows.map((row) => row.best);
  const maxBest = Math.max(...releasedBest);
  const headrooms = releasedRows.map((row) => row.headroom);
  const wave1 = [...released].filter(([pkg]) => waveOf.get(pkg) === 1);
  const wave2 = [...released].filter(([pkg]) => waveOf.get(pkg) === 2);

  // Per-cell best-trivial macros for the cells the prose cites: a
  // wave-1 package gets Old/New (0.1.0/0.2.0) when either side is
  // nonzero, a wave-2 package gets Rel at its released version when
  // nonzero. A wave-1 package with one unmeasured arm and one nonzero
  // arm fails instead of printing a fabricated zero.
  const cellMacros = [];
  for (const pkg of [...released.keys()].sort()) {
    const label = camel(pkg);
    if (waveOf.get(pkg) === 1) {
      const oldBest = bestAt(pkg, "0.1.0");
      const newBest = bestAt(pkg, "0.2.0");
      if (oldBest === undefined || newBest === undefined) {
        if ((oldBest ?? 0) > 0 || (newBest ?? 0) > 0) {
          fail(`trivial-headroom.csv: incomplete wave-1 arm for ${pkg}`);
        }
        continue;
      }
      if (oldBest > 0 || newBest > 0) {
        cellMacros.push([`expTriv${label}Old`, oldBest]);
        cellMacros.push([`expTriv${label}New`, newBest]);
      }
    } else {
      const best = bestAt(pkg, released.get(pkg));
      if (best !== undefined && best > 0) {
        cellMacros.push([`expTriv${label}Rel`, best]);
      }
    }
  }

  const runtimeBatteryMin = (runtimeSec(runtimes, "E1") / 60).toFixed(1);
  const runtimeProbesSec = runtimeSec(runtimes, "E4");

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
    cellMacros,
    formatGateAllPkgs,
    formatGateNone,
    headroomMin: Math.min(...headrooms),
    headroomMedian: median(headrooms),
    headroomMax: Math.max(...headrooms),
    headroomBelowOne: headrooms.filter((h) => h < 1).length,
    oracleBelowOnePkgs: releasedRows.filter((row) => row.oracle < 1).map((row) => row.pkg),
    zeroRows,
    classCounts,
    probes: probeIds.size,
    probeCells: contract.length,
    probesHonestAccepted,
    probesHonestPromised,
    probesHonestUnpromised,
    probesHonestCells,
    probesHonestHeld,
    probesForgedAccepted: forgedAcceptedPkgs.length,
    probesForgedAcceptedPkgs: forgedAcceptedPkgs,
    probesFailedCells,
    probesReleasedCells,
    probesOutsideContract,
    probesNotRunnable,
    probesCreditFailCells,
    probesMovedFailCells,
    probesDupCallCells,
    probesWrapCells,
    probesCreditFailPkgs: creditFailPkgs,
    probesMovedFailPkgCount: movedFailPkgs.length,
    probesDupCallPkgs: dupCallPkgs,
    probesDupCallPkgCount: dupCallPkgs.length,
    probesWrapPkgs: wrapPkgs,
    probesWrapPkgCount: wrapPkgs.length,
    auditArtifacts: auditKeys.size,
    auditLeaksFound: leaksFound,
    auditSeedExamples: seedExamples,
    auditCensusQualified: qualified.size,
    auditSeedlessQualified: seedlessQualified,
    auditSeeds: seedSet.size,
    auditMaxPromptOverlapPct: maxPromptPct.toFixed(1),
    auditMaxExpectedOverlapPct: maxExpectedPct.toFixed(1),
    auditMaxIdSuffixPct: maxIdSuffixPct.toFixed(1),
    detPackages: detArtifacts.size,
    detRuns: determinism.length,
    detMockRuns,
    detTrivialRuns,
    detSeedList: andList(detMockSeeds),
    detConcurrencyList: andList(detMockConc),
    detRepeats: detMockRepeats,
    detFailedRuns,
    detIdentical,
    detDriftPkgs,
    explFrozen: exploits.length,
    explRunRows: explRowsRun.size,
    explPolicyOnly,
    explClauses,
    explRecordClauses,
    explPostfixClauses,
    explTotals,
    explCounts,
    explPartClauses: { a: explA.length, b: explB.length, c: explC.length },
    explAtkRows,
    explBadRows,
    explAtkMedianOld: median(atkOld),
    explAtkMedianNew: median(atkNew),
    explAtkMaxNew: Math.max(...atkNew),
    explAtkW2Max: atkW2Rel.length ? Math.max(...atkW2Rel) : 0,
    explAtkMaxRel: atkRel.length ? Math.max(...atkRel) : 0,
    explFixFailPkgs: [...fixFailPkgs],
    explReleasedRows,
    explCommitRows,
    explReplReleased: explCounts.a.replicated + explCounts.b.replicated + replTarball,
    explReplCommit: replCommit,
    explNotReplReleased: explCounts.a["not-replicated"] + explCounts.b["not-replicated"] + notReplTarball,
    explNotReplCommit: notReplCommit,
    explFixFailsAttack: explBadRows.filter((r) => r.verdict === "fix-fails" && r.attack).length,
    explFixFailsHonest: explBadRows.filter((r) => r.verdict === "fix-fails" && !r.attack).length,
    explFixFailsAttackPkgs: [...fixFailAttackPkgs],
    explFixFailsHonestPkgs: [...fixFailHonestPkgs],
    explFixHoldsWeak,
    explAtkPairs: atkPairs.length,
    explAtkMedianOldPaired: median(atkPairs.map((d) => d.old)),
    explAtkMedianNewPaired: median(atkPairs.map((d) => d.new)),
    explAtkNewOnly,
    explAtkOldOnly,
    explNotReplicatedList,
    runtimeBatteryMin,
    runtimeProbesSec,
    reasonClassCount,
    reasonClassRules,
    reasonClassPkgs,
    probesHonest,
    probesAttack,
    probesExploratory,
    policyOnlyRows,
    runtimeExplASec: runtimeSec(runtimes, "E2a"),
    runtimeExplBSec: runtimeSec(runtimes, "E2b"),
    runtimeExplCSec: runtimeSec(runtimes, "E2c"),
    runtimeAuditSec: runtimeSec(runtimes, "E5a"),
    runtimeOverlapSec: runtimeSec(runtimes, "E5b"),
    runtimeDeterminismSec: runtimeSec(runtimes, "E6"),
  };
}

// Wall-clock seconds for a scripted experiment, read from the measured
// runtimes.csv. The conclusion quotes these as the cost of the scripted
// checks, so a missing or implausible row fails the build.
function runtimeSec(runtimes, experiment) {
  const rows = runtimes.filter((row) => row.experiment === experiment);
  if (rows.length !== 1) {
    fail(`runtimes.csv: ${rows.length} rows for ${experiment}, want 1`);
  }
  const sec = Number(rows[0].wall_seconds);
  if (!Number.isFinite(sec) || sec <= 0) {
    fail(`runtimes.csv: bad wall_seconds for ${experiment}`);
  }
  return sec;
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
    ...stats.cellMacros.map(([name, value]) => `\\newcommand{\\${name}}{${fmt(value)}}`),
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
    `\\newcommand{\\expFormatGateAllPkgs}{${pkgList(stats.formatGateAllPkgs)}}`,
    `\\newcommand{\\expFormatGateNone}{${stats.formatGateNone}}`,
    `\\newcommand{\\expRuntimeBatteryMin}{${stats.runtimeBatteryMin}}`,
    `\\newcommand{\\expRuntimeProbesSec}{${stats.runtimeProbesSec}}`,
    `\\newcommand{\\expProbes}{${stats.probes}}`,
    `\\newcommand{\\expProbeCells}{${stats.probeCells}}`,
    `\\newcommand{\\expProbesHonestAccepted}{${stats.probesHonestAccepted}}`,
    `\\newcommand{\\expProbesHonestPromised}{${stats.probesHonestPromised}}`,
    `\\newcommand{\\expProbesHonestUnpromised}{${stats.probesHonestUnpromised}}`,
    `\\newcommand{\\expProbesHonestCells}{${stats.probesHonestCells}}`,
    `\\newcommand{\\expProbesHonestHeld}{${stats.probesHonestHeld}}`,
    `\\newcommand{\\expProbesForgedAccepted}{${stats.probesForgedAccepted}}`,
    `\\newcommand{\\expProbesForgedAcceptedPkgs}{${pkgList(stats.probesForgedAcceptedPkgs)}}`,
    `\\newcommand{\\expProbesFailedCells}{${stats.probesFailedCells}}`,
    `\\newcommand{\\expProbesReleasedCells}{${stats.probesReleasedCells}}`,
    `\\newcommand{\\expProbesOutsideContract}{${stats.probesOutsideContract}}`,
    `\\newcommand{\\expProbesNotRunnable}{${stats.probesNotRunnable}}`,
    `\\newcommand{\\expProbesCreditFailCells}{${stats.probesCreditFailCells}}`,
    `\\newcommand{\\expProbesMovedFailCells}{${stats.probesMovedFailCells}}`,
    `\\newcommand{\\expProbesCreditFailPkgs}{${pkgList(stats.probesCreditFailPkgs)}}`,
    `\\newcommand{\\expProbesMovedFailPkgCount}{${stats.probesMovedFailPkgCount}}`,
    `\\newcommand{\\expProbesDupCallCells}{${stats.probesDupCallCells}}`,
    `\\newcommand{\\expProbesDupCallPkgs}{${pkgList(stats.probesDupCallPkgs)}}`,
    `\\newcommand{\\expProbesDupCallPkgCount}{${stats.probesDupCallPkgCount}}`,
    `\\newcommand{\\expProbesWrapCells}{${stats.probesWrapCells}}`,
    `\\newcommand{\\expProbesWrapPkgs}{${pkgList(stats.probesWrapPkgs)}}`,
    `\\newcommand{\\expProbesWrapPkgCount}{${stats.probesWrapPkgCount}}`,
    `\\newcommand{\\expAuditArtifacts}{${stats.auditArtifacts}}`,
    `\\newcommand{\\expAuditLeaksFound}{${stats.auditLeaksFound}}`,
    `\\newcommand{\\expAuditSeedExamples}{${stats.auditSeedExamples}}`,
    `\\newcommand{\\expAuditCensusQualified}{${stats.auditCensusQualified}}`,
    `\\newcommand{\\expAuditSeedlessQual}{${stats.auditSeedlessQualified}}`,
    `\\newcommand{\\expAuditSeeds}{${stats.auditSeeds}}`,
    `\\newcommand{\\expAuditMaxPromptOverlapPct}{${stats.auditMaxPromptOverlapPct}}`,
    `\\newcommand{\\expAuditMaxExpectedOverlapPct}{${stats.auditMaxExpectedOverlapPct}}`,
    `\\newcommand{\\expAuditMaxIdSuffixPct}{${stats.auditMaxIdSuffixPct}}`,
    `\\newcommand{\\expDetPackages}{${stats.detPackages}}`,
    `\\newcommand{\\expDetRuns}{${stats.detRuns}}`,
    `\\newcommand{\\expDetMockRuns}{${stats.detMockRuns}}`,
    `\\newcommand{\\expDetTrivialRuns}{${stats.detTrivialRuns}}`,
    `\\newcommand{\\expDetSeedList}{${stats.detSeedList}}`,
    `\\newcommand{\\expDetConcurrencyList}{${stats.detConcurrencyList}}`,
    `\\newcommand{\\expDetRepeats}{${stats.detRepeats}}`,
    `\\newcommand{\\expDetFailedRuns}{${stats.detFailedRuns}}`,
    `\\newcommand{\\expDetIdentical}{${stats.detIdentical}}`,
    `\\newcommand{\\expDetDriftPkgs}{${pkgList(stats.detDriftPkgs)}}`,
    `\\newcommand{\\expExplFrozen}{${stats.explFrozen}}`,
    `\\newcommand{\\expExplRunRows}{${stats.explRunRows}}`,
    `\\newcommand{\\expExplPolicyOnly}{${stats.explPolicyOnly}}`,
    `\\newcommand{\\expExplClauses}{${stats.explClauses}}`,
    `\\newcommand{\\expExplRecordClauses}{${stats.explRecordClauses}}`,
    `\\newcommand{\\expExplPostfixClauses}{${stats.explPostfixClauses}}`,
    `\\newcommand{\\expExplReplicated}{${stats.explTotals.replicated}}`,
    `\\newcommand{\\expExplNotReplicated}{${stats.explTotals["not-replicated"]}}`,
    `\\newcommand{\\expExplFixHolds}{${stats.explTotals["fix-holds"]}}`,
    `\\newcommand{\\expExplFixFails}{${stats.explTotals["fix-fails"]}}`,
    `\\newcommand{\\expExplNotRunnable}{${stats.explTotals["not-runnable"]}}`,
    `\\newcommand{\\expExplAtkRows}{${stats.explAtkRows}}`,
    `\\newcommand{\\expExplAtkMedianOld}{${fmt(stats.explAtkMedianOld)}}`,
    `\\newcommand{\\expExplAtkMedianNew}{${fmt(stats.explAtkMedianNew)}}`,
    `\\newcommand{\\expExplAtkMaxNew}{${fmt(stats.explAtkMaxNew)}}`,
    `\\newcommand{\\expExplAtkWaveTwoMax}{${fmt(stats.explAtkW2Max)}}`,
    `\\newcommand{\\expExplAtkMaxRel}{${fmt(stats.explAtkMaxRel)}}`,
    `\\newcommand{\\expExplFixFailsPkgs}{${pkgList(stats.explFixFailPkgs)}}`,
    `\\newcommand{\\expExplReleasedRows}{${stats.explReleasedRows}}`,
    `\\newcommand{\\expExplCommitRows}{${stats.explCommitRows}}`,
    `\\newcommand{\\expExplReplReleased}{${stats.explReplReleased}}`,
    `\\newcommand{\\expExplReplCommit}{${stats.explReplCommit}}`,
    `\\newcommand{\\expExplNotReplReleased}{${stats.explNotReplReleased}}`,
    `\\newcommand{\\expExplNotReplCommit}{${stats.explNotReplCommit}}`,
    `\\newcommand{\\expExplFixFailsAttack}{${stats.explFixFailsAttack}}`,
    `\\newcommand{\\expExplFixFailsHonest}{${stats.explFixFailsHonest}}`,
    `\\newcommand{\\expExplFixFailsAttackPkgs}{${pkgList(stats.explFixFailsAttackPkgs)}}`,
    `\\newcommand{\\expExplFixFailsHonestPkgs}{${pkgList(stats.explFixFailsHonestPkgs)}}`,
    `\\newcommand{\\expExplFixHoldsWeak}{${stats.explFixHoldsWeak}}`,
    `\\newcommand{\\expExplAtkPairs}{${stats.explAtkPairs}}`,
    `\\newcommand{\\expExplAtkMedianOldPaired}{${fmt(stats.explAtkMedianOldPaired)}}`,
    `\\newcommand{\\expExplAtkMedianNewPaired}{${fmt(stats.explAtkMedianNewPaired)}}`,
    `\\newcommand{\\expExplAtkNewOnly}{${stats.explAtkNewOnly}}`,
    `\\newcommand{\\expExplNotReplicatedList}{${stats.explNotReplicatedList}}`,
    `\\newcommand{\\expReasonClasses}{${stats.reasonClassCount}}`,
    `\\newcommand{\\expReasonClassRules}{${stats.reasonClassRules}}`,
    `\\newcommand{\\expReasonClassPkgs}{${stats.reasonClassPkgs}}`,
    `\\newcommand{\\expProbesHonest}{${stats.probesHonest}}`,
    `\\newcommand{\\expProbesAttack}{${stats.probesAttack}}`,
    `\\newcommand{\\expProbesExploratory}{${stats.probesExploratory}}`,
    `\\newcommand{\\expRuntimeExplASec}{${stats.runtimeExplASec}}`,
    `\\newcommand{\\expRuntimeExplBSec}{${stats.runtimeExplBSec}}`,
    `\\newcommand{\\expRuntimeExplCSec}{${stats.runtimeExplCSec}}`,
    `\\newcommand{\\expRuntimeAuditSec}{${stats.runtimeAuditSec}}`,
    `\\newcommand{\\expRuntimeOverlapSec}{${stats.runtimeOverlapSec}}`,
    `\\newcommand{\\expRuntimeDeterminismSec}{${stats.runtimeDeterminismSec}}`,
    ...["a", "b", "c"].flatMap((part) => [
      `\\newcommand{\\expExpl${part.toUpperCase()}Clauses}{${stats.explPartClauses[part]}}`,
      ...Object.keys(stats.explCounts[part]).map(
        (v) => `\\newcommand{\\expExpl${part.toUpperCase()}${camel(v)}}{${stats.explCounts[part][v]}}`,
      ),
    ]),
    "",
  );
  return `${lines.join("\n")}`;
}

// A GitHub locator shortens for the T3 bad-rows list:
// .../issues/8 -> issue 8, .../pull/12 -> PR 12,
// .../blob/<sha>/<path>#L7 -> <basename> L7, .../commit/<sha> -> commit <8>.
function shortLocator(locator) {
  const issue = locator.match(/\/issues\/(\d+)$/);
  if (issue) return `issue ${issue[1]}`;
  const pull = locator.match(/\/pull\/(\d+)$/);
  if (pull) return `PR ${pull[1]}`;
  const commit = locator.match(/\/commit\/([0-9a-f]{40})$/);
  if (commit) return `commit ${commit[1].slice(0, 8)}`;
  const blob = locator.match(/\/blob\/[0-9a-f]{40}\/([^#]+?)(?:#L(\d+))?$/);
  if (blob) return `${blob[1].split("/").pop()}${blob[2] ? ` L${blob[2]}` : ""}`;
  fail(`locator does not shorten: ${locator}`);
}

// Escape free text from the frozen exploit list for a table cell.
function texCell(text) {
  return String(text)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[&%#_]/g, (ch) => `\\${ch}`)
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

// The frozen rows no run could reach: every needs-reviewer-policy row
// of exploits.csv as a table body, so the appendix list cannot drift
// from the list it describes. r<n> is the row's line number, the same
// citation Table T3 uses.
function policyOnlyTex(stats) {
  const rows = stats.policyOnlyRows
    .map(
      ({ row, line }) =>
        `r${line} & ${ttId(row.package)} & \\texttt{${shortLocator(row.locator)}} & ${texCell(row.why)} \\\\`,
    )
    .join("\n");
  return `% Generated by scripts/exp/macros.mjs. Do not edit.
% The needs-reviewer-policy rows of paper/data/exp/exploits.csv: the
% frozen exploit rows no run could measure because the record does not
% pin the reviewer's policy enough to rebuild it identically.
\\begin{tabular}{@{}r>{\\raggedright\\arraybackslash}p{0.18\\textwidth}>{\\raggedright\\arraybackslash}p{0.16\\textwidth}>{\\raggedright\\arraybackslash}p{0.48\\textwidth}@{}}
\\toprule
row & package & locator & why no run reached it \\\\
\\midrule
${rows}
\\bottomrule
\\end{tabular}
`;
}

const EXPL_PART_LABEL = {
  a: "a (single answers, tarballs)",
  b: "b (episodes, tarballs)",
  c: "c (source checkouts)",
};

// Table T3: verdict counts by run part and in total, then the compact
// list of every not-replicated and every fix-fails clause with
// package, locator, what the relation compares against and the
// measured number. A fix-fails on an attack row means the shipped fix
// still pays the exploit; on an honest re-check row (an equals-oracle
// clause) it means the grader still rejects the honest answer, and
// the verdict cell says so. Both are reported as found, never
// softened.
function verdictsFloat(stats) {
  const countLine = (part) =>
    `${EXPL_PART_LABEL[part]} & ${stats.explPartClauses[part]} & ${stats.explCounts[part].replicated} & ${stats.explCounts[part]["not-replicated"]} & ${stats.explCounts[part]["fix-holds"]} & ${stats.explCounts[part]["fix-fails"]} & ${stats.explCounts[part]["not-runnable"]} \\\\`;
  const verdictCell = (r) => `${r.verdict.replace("-", " ")}${r.attack ? "" : " (honest)"}`;
  return `% Generated by scripts/exp/macros.mjs. Do not edit.
% Table T3: clause verdicts on the exploit re-measurement, from
% paper/data/exp/exploit-results-{a,b,c}.csv over the frozen list
% paper/data/exp/exploits.csv.
\\begin{table}[!tbp]
\\centering
\\caption{Verdicts on the \\expExplClauses{} clauses the re-measurement runs evaluated over the \\expExplFrozen{} frozen exploit rows, by run part (data: \\texttt{exploit-results-}\\allowbreak\\texttt{\\{a,b,c\\}.csv}). A clause pairs a target, a released version or a pinned commit, with the relation the measured score must satisfy there, and the vs column names what the relation compares against. A replicated clause re-measured the logged number or bound; fix-holds and fix-fails judge the post-fix state against the frozen relation, so a fix-fails on an attack row means the shipped fix still pays the exploit, while on an honest re-check row (an \\emph{equals oracle} clause, marked \\emph{honest}) it means the grader still rejects the honest answer. The single not-runnable row is a locator-coverage row outside the run plan. The lower block lists every clause that did not replicate and every post-fix clause that failed; \\texttt{r<n>} is the row's line in \\texttt{paper/data/exp/exploits.csv}. A further \\expExplPolicyOnly{} frozen rows need the reviewer's unreleased policy and produced no clause.}
\\label{tab:exploit-verdicts}
{\\small
\\begin{tabular}{@{}lrrrrrr@{}}
\\toprule
run part & clauses & replicated & not repl. & fix holds & fix fails & not run. \\\\
\\midrule
${countLine("a")}
${countLine("b")}
${countLine("c")}
\\midrule
total & ${stats.explClauses} & ${stats.explTotals.replicated} & ${stats.explTotals["not-replicated"]} & ${stats.explTotals["fix-holds"]} & ${stats.explTotals["fix-fails"]} & ${stats.explTotals["not-runnable"]} \\\\
\\bottomrule
\\end{tabular}

\\vspace{1.5ex}
{\\footnotesize\\setlength{\\tabcolsep}{3pt}
\\begin{tabular}{@{}llllllrr@{}}
\\toprule
row & package & locator & verdict & where & vs & measured & record \\\\
\\midrule
${stats.explBadRows
  .map(
    (r) =>
      `r${r.row} & ${ttId(r.pkg)} & \\texttt{${shortLocator(r.locator)}} & ${verdictCell(r)} & ${r.where} & ${r.vs} & ${r.measured} & ${r.record.replace("%", "\\%")} \\\\`,
  )
  .join("\n")}
\\bottomrule
\\end{tabular}}
}
\\end{table}
`;
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

function checkFresh(path, expected) {
  if (!existsSync(path)) fail(`${path.slice(ROOT.length + 1)} does not exist; run node scripts/exp/macros.mjs`);
  if (readFileSync(path, "utf8") !== expected) {
    fail(`${path.slice(ROOT.length + 1)} is stale; run node scripts/exp/macros.mjs`);
  }
}

function check(expected) {
  checkFresh(OUT, expected);
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
const verdicts = verdictsFloat(stats);
const policyOnly = policyOnlyTex(stats);

if (process.argv.includes("--check")) {
  const defined = check(expected);
  checkFresh(VERDICTS_OUT, verdicts);
  checkFresh(POLICY_ONLY_OUT, policyOnly);
  console.log(`exp-macros.mjs: ${defined} macros defined, all \\exp* uses covered, generated files fresh`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, expected);
  writeFileSync(VERDICTS_OUT, verdicts);
  writeFileSync(POLICY_ONLY_OUT, policyOnly);
  console.log(`packages=${stats.packages} artifacts=${stats.artifacts} cells=${stats.cells} failed=${stats.failedCells} rows=${stats.batteryRows}`);
  console.log(`released best-trivial max=${fmt(stats.releasedMax)} zero=${stats.releasedZero}/${stats.packages} headroom ${fmt(stats.headroomMin)}..${fmt(stats.headroomMax)} (median ${fmt(stats.headroomMedian)})`);
  console.log(`zero rows=${stats.zeroRows} format-gate=${stats.classCounts["format-gate"]} (${pct(stats.classCounts["format-gate"], stats.zeroRows)}% of zeros)`);
  console.log(`exploit clauses=${stats.explClauses} replicated=${stats.explTotals.replicated} fix-fails=${stats.explTotals["fix-fails"]} -> ${OUT.slice(ROOT.length + 1)} + exploit-verdicts.tex, ok`);
}
