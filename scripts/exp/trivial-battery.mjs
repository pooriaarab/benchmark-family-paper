#!/usr/bin/env node
// E1 trivial battery: run the 8 vendored trivial policies on every pinned
// artifact, keep every row, classify the zero-score reasons with the frozen
// classes, and check the 192 registered cells against paper/data/trivial.csv.
//
// One server process serves the whole run and cells go in the registered
// eval-matrix order: every wave-1 policy block first (policy major, then
// package, then version), then the wave-2 blocks the same way, sequential
// at concurrency 1. trivial-random is seeded by the server's request
// count, so that order is what makes the registered cells reproduce; do
// not reorder, split, or parallelise the run.
//
//   node scripts/exp/trivial-battery.mjs                     # full 272-cell run
//   node scripts/exp/trivial-battery.mjs --only a@0.1.0,b@0.1.0 --out /tmp/x

import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const CLASSES = join(ROOT, "scripts/exp/reason-classes.json");
const SERVER = join(ROOT, "scripts/exp/trivial-policy-server.py");
const TRIVIAL = join(ROOT, "paper/data/trivial.csv");
const POLICIES = ["empty", "yes", "ok", "refuse", "echo", "firsttool", "random", "nulljson"];
const TOLERANCE = 0.001;

function fail(message) {
  console.error(`trivial-battery: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    cache: join(ROOT, ".exp-cache"),
    out: join(ROOT, "paper/data/exp"),
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cache") args.cache = resolve(argv[++i]);
    else if (argv[i] === "--out") args.out = resolve(argv[++i]);
    else if (argv[i] === "--only") args.only = new Set(argv[++i].split(","));
    else fail(`unknown argument ${argv[i]}`);
  }
  return args;
}

// Same bit as benchmark-core mockAdapter and scripts/collect.mjs:
// ((fnv1a(taskId) ^ seed) & 1) === 1 selects the scripted good policy.
function fnv1a(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function mockGood(taskId, seed) {
  return ((fnv1a(taskId) ^ seed) & 1) === 1;
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function waitForServer(port, proc) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) fail(`policy server exited early with code ${proc.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  fail("policy server did not answer /v1/models within 5 s");
}

function runCell(dir, name, args, env) {
  const run = () => {
    try {
      const stdout = execFileSync(
        "npx",
        ["--no-install", name, ...args],
        { cwd: dir, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600000 },
      );
      return { stdout, code: 0 };
    } catch (error) {
      return { stdout: error.stdout ?? "", code: error.status ?? 1 };
    }
  };
  const parse = (stdout) => {
    try {
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed.rows) && typeof parsed.mean === "number" ? parsed : null;
    } catch {
      return null;
    }
  };
  let { stdout, code } = run();
  let report = parse(stdout);
  if (code !== 0 || report === null) {
    ({ stdout, code } = run());
    const second = parse(stdout);
    if (second !== null) report = second;
    if (code !== 0 || report === null) return { report, failed: true, retried: true };
    return { report, failed: false, retried: true };
  }
  return { report, failed: false, retried: false };
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"` : text;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\n")}\n`;
}

function fmt(value) {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}

const args = parseArgs(process.argv.slice(2));
const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
const classes = JSON.parse(readFileSync(CLASSES, "utf8"));

let artifacts = doc.artifacts;
if (args.only) {
  const missing = [...args.only].filter(
    (id) => !artifacts.some((a) => `${a.name}@${a.version}` === id),
  );
  if (missing.length) fail(`not pinned in versions.json: ${missing.join(", ")}`);
  artifacts = artifacts.filter((a) => args.only.has(`${a.name}@${a.version}`));
}
const wave1 = artifacts.filter((a) => a.wave === 1);
const wave2 = artifacts.filter((a) => a.wave === 2);

const absent = artifacts.filter(
  (a) => !existsSync(join(args.cache, `${a.name}@${a.version}`, "install.ok")),
);
if (absent.length) {
  fail(`cache is missing ${absent.map((a) => `${a.name}@${a.version}`).join(", ")}; run scripts/exp/install.mjs first`);
}

const shared = (classes.shared ?? []).map((rule) => ({ ...rule, re: new RegExp(rule.pattern) }));
const perPackage = {};
for (const [pkg, rules] of Object.entries(classes.packages ?? {})) {
  perPackage[pkg] = rules.map((rule) => ({ ...rule, re: new RegExp(rule.pattern) }));
}
function classify(pkg, reason) {
  const text = reason ?? "";
  for (const rule of [...shared, ...(perPackage[pkg] ?? [])]) {
    if (rule.re.test(text)) return rule.class;
  }
  return "unclassified";
}

const port = await freePort();
const server = spawn("python3", [SERVER, "--port", String(port)], { stdio: ["ignore", "ignore", "inherit"] });
await waitForServer(port, server);
console.error(`trivial-battery: policy server on port ${port}`);

const env = {
  ...process.env,
  OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  OPENAI_API_KEY: "trivial",
  NO_COLOR: "1",
};

const rows = [];
const cells = [];
let cellCount = 0;
const totalCells = artifacts.length * POLICIES.length;
try {
  for (const block of [wave1, wave2]) {
    for (const policy of POLICIES) {
      for (const artifact of block) {
        const id = `${artifact.name}@${artifact.version}`;
        const dir = join(args.cache, id);
        const { report, failed, retried } = runCell(dir, artifact.name, [
          "run", "--provider", "openai", "--model", `trivial-${policy}`,
          "--json", "--seed", "1", "--concurrency", "1",
        ], env);
        cellCount += 1;
        if (report === null) {
          cells.push({ pkg: artifact.name, ver: artifact.version, policy, mean: null, rows: 0, tasks: 0 });
          console.error(`[${cellCount}/${totalCells}] ${id} trivial-${policy}: FAILED${retried ? " after retry" : ""}`);
          continue;
        }
        for (const row of report.rows) {
          rows.push({ pkg: artifact.name, ver: artifact.version, policy, task: row.taskId, score: row.score, reason: row.reason ?? "" });
        }
        cells.push({ pkg: artifact.name, ver: artifact.version, policy, mean: report.mean, rows: report.rows.length, tasks: report.totals?.tasks ?? report.rows.length });
        console.error(`[${cellCount}/${totalCells}] ${id} trivial-${policy}: mean ${fmt(report.mean)}${retried ? " (retried)" : ""}${failed ? " (rows kept after failed retry)" : ""}`);
      }
    }
  }
} finally {
  server.kill();
}

const oracle = {};
for (const artifact of artifacts) {
  const id = `${artifact.name}@${artifact.version}`;
  const dir = join(args.cache, id);
  const reports = {};
  for (const seed of [1, 2]) {
    const { report } = runCell(dir, artifact.name, [
      "run", "--provider", "mock", "--model", "offline",
      "--json", "--seed", String(seed), "--concurrency", "1",
    ], env);
    if (report === null) fail(`${id}: mock run at seed ${seed} failed`);
    reports[seed] = report;
  }
  const bySeed2 = new Map(reports[2].rows.map((row) => [row.taskId, row]));
  const goodScores = reports[1].rows.map((row) => {
    const other = bySeed2.get(row.taskId);
    if (other === undefined) fail(`${id}: task ${row.taskId} missing from the seed-2 mock run`);
    return (mockGood(row.taskId, 1) ? row : other).score;
  });
  oracle[id] = {
    mean: reports[1].mean,
    goodMean: goodScores.reduce((sum, v) => sum + v, 0) / goodScores.length,
  };
}

const byKey = new Map();
for (const cell of cells) {
  const key = `${cell.pkg}|${cell.ver}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(cell);
}

const headroom = [];
for (const [key, list] of byKey) {
  const [pkg, ver] = key.split("|");
  const live = list.filter((cell) => cell.mean !== null);
  const best = live.length ? Math.max(...live.map((cell) => cell.mean)) : null;
  const winners = best === null ? [] : live.filter((cell) => Math.abs(cell.mean - best) < 1e-9);
  const bestPolicy = winners.length === 1 ? `trivial-${winners[0].policy}` : "tie";
  const oracleMean = oracle[key.replace("|", "@")]?.goodMean;
  headroom.push({
    pkg, ver,
    oracle: oracleMean ?? null,
    bestPolicy,
    best,
    headroom: best === null || oracleMean === undefined ? null : oracleMean - best,
  });
}

const reasonCounts = new Map();
let zeroRows = 0;
let unclassifiedRows = 0;
for (const row of rows) {
  if (row.score !== 0) continue;
  zeroRows += 1;
  const cls = classify(row.pkg, row.reason);
  if (cls === "unclassified") unclassifiedRows += 1;
  const key = `${row.pkg}|${row.ver}|${cls}`;
  reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
}

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "trivial-battery.csv"), csv([
  ["package", "version", "policy", "task", "score", "reason"],
  ...rows.map((row) => [row.pkg, row.ver, `trivial-${row.policy}`, row.task, fmt(row.score), row.reason]),
]));
writeFileSync(join(args.out, "trivial-battery-cells.csv"), csv([
  ["package", "version", "policy", "mean", "rows", "tasks"],
  ...cells.map((cell) => [cell.pkg, cell.ver, `trivial-${cell.policy}`, cell.mean === null ? "" : fmt(cell.mean), cell.rows, cell.tasks]),
]));
writeFileSync(join(args.out, "trivial-reasons.csv"), csv([
  ["package", "version", "class", "count"],
  ...[...reasonCounts.entries()].sort().map(([key, count]) => [...key.split("|"), count]),
]));
writeFileSync(join(args.out, "trivial-headroom.csv"), csv([
  ["package", "version", "oracle", "best_policy", "best_trivial", "headroom"],
  ...headroom.map((h) => [h.pkg, h.ver, h.oracle === null ? "" : fmt(h.oracle), h.bestPolicy, h.best === null ? "" : fmt(h.best), h.headroom === null ? "" : fmt(h.headroom)]),
]));
console.error(`trivial-battery: wrote ${rows.length} rows, ${cells.length} cells, ${reasonCounts.size} class rows to ${args.out}`);

const unclassifiedShare = zeroRows ? unclassifiedRows / zeroRows : 0;
if (unclassifiedShare > 0.1) {
  console.error(`WARNING: ${(unclassifiedShare * 100).toFixed(1)}% of zero-score rows are unclassified (over 10%)`);
}

let replicationOk = null;
if (!args.only) {
  const registered = new Map(
    readFileSync(TRIVIAL, "utf8").trim().split("\n").slice(1).map((line) => {
      const [pkg, old, new_] = line.split(",");
      return [pkg, { old: Number(old), new: Number(new_) }];
    }),
  );
  let mismatches = 0;
  for (const [pkg, want] of registered) {
    for (const [ver, wantMean] of [["0.1.0", want.old], ["0.2.0", want.new]]) {
      const got = headroom.find((h) => h.pkg === pkg && h.ver === ver)?.best;
      if (got === null || got === undefined || Math.abs(got - wantMean) > TOLERANCE) {
        console.error(`REPLICATION MISMATCH ${pkg}@${ver}: measured best ${got === null || got === undefined ? "missing" : fmt(got)} vs trivial.csv ${fmt(wantMean)}`);
        mismatches += 1;
      }
    }
  }
  replicationOk = mismatches === 0;
  console.error(replicationOk ? "replication check: 192 registered cells reproduce trivial.csv" : `replication check: ${mismatches} mismatch(es)`);
} else {
  console.error("replication check: skipped (subset run)");
}

const bests1 = headroom.filter((h) => h.ver === "0.1.0" && h.best !== null).map((h) => h.best);
const bests2 = headroom.filter((h) => h.ver === "0.2.0" && h.best !== null).map((h) => h.best);
const headrooms = headroom.filter((h) => h.headroom !== null).map((h) => h.headroom);
console.log(`packages: ${byKey.size} artifacts, ${cells.length} cells, ${rows.length} rows`);
console.log(`max trivial score at 0.1.0: ${bests1.length ? fmt(Math.max(...bests1)) : "n/a"}; at 0.2.0: ${bests2.length ? fmt(Math.max(...bests2)) : "n/a"}`);
console.log(`zero-score rows: ${zeroRows} of ${rows.length}; unclassified: ${unclassifiedRows} (${(unclassifiedShare * 100).toFixed(1)}%)`);
console.log(`headroom range: ${headrooms.length ? `${fmt(Math.min(...headrooms))} to ${fmt(Math.max(...headrooms))}` : "n/a"}`);
console.log(`replication: ${replicationOk === null ? "skipped" : replicationOk ? "ok" : "FAILED"}`);
if (replicationOk === false) process.exit(1);
