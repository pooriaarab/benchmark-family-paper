#!/usr/bin/env node
// E6 determinism: run the released version of all 22 packages under the
// mock provider at seeds 1 and 2, concurrency 1, 4 and 16, three repeats
// each, plus three repeats of the trivial-server path through the
// vendored trivial-policy-server.py. Every run is hashed over its
// (taskId, score, reason) rows; a package counts as byte-identical when
// all runs in each of its (path, seed) groups produce the same hash.
// The matrix is frozen in scripts/exp/determinism.json; the failure
// modes live in determinism.failure-modes.md.
//
//   node scripts/exp/determinism.mjs                 # full run, about 5 min
//   node scripts/exp/determinism.mjs --only a@0.2.0,b@0.1.0 --out /tmp/x

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG = join(ROOT, "scripts/exp/determinism.json");
const SERVER = join(ROOT, "scripts/exp/trivial-policy-server.py");

function fail(message) {
  console.error(`determinism: ${message}`);
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

function parseReport(stdout) {
  try {
    const report = JSON.parse(stdout);
    return Array.isArray(report.rows) && typeof report.mean === "number" ? report : null;
  } catch {
    return null;
  }
}

function runOnce(dir, name, cliArgs, env, timeoutMs) {
  const attempt = () => {
    try {
      const stdout = execFileSync(
        "npx",
        ["--no-install", name, ...cliArgs],
        { cwd: dir, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" },
      );
      return { stdout, status: "ok" };
    } catch (error) {
      const status = error.signal === "SIGKILL" || error.killed ? "timeout" : "failed";
      return { stdout: error.stdout ?? "", status };
    }
  };
  let { stdout, status } = attempt();
  let report = status === "ok" ? parseReport(stdout) : null;
  if (report !== null) return { report, status };
  ({ stdout, status } = attempt());
  report = status === "ok" ? parseReport(stdout) : null;
  return report === null ? { report: null, status } : { report, status: "ok-after-retry" };
}

function canonHash(rows) {
  const lines = rows
    .map((row) => JSON.stringify([row.taskId, row.score, row.reason ?? ""]))
    .sort()
    .join("\n") + "\n";
  return createHash("sha256").update(lines, "utf8").digest("hex");
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"` : text;
}

function fmt(value) {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}

const args = parseArgs(process.argv.slice(2));
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const nodeVersion = execFileSync("node", ["-v"], { encoding: "utf8" }).trim();

let ids = config.artifacts;
if (args.only) {
  const missing = [...args.only].filter((id) => !ids.includes(id));
  if (missing.length) fail(`not in the frozen matrix: ${missing.join(", ")}`);
  ids = ids.filter((id) => args.only.has(id));
}
const absent = ids.filter((id) => !existsSync(join(args.cache, id, "install.ok")));
if (absent.length) {
  fail(`cache is missing ${absent.join(", ")}; run scripts/exp/install.mjs first`);
}

const env = { ...process.env, NO_COLOR: "1" };
const { seeds, concurrency, repeats } = config.mockArm;
const trivial = config.trivialServerArm;
const timeoutMs = config.perRunTimeoutMs;
const total = ids.length * (seeds.length * concurrency.length * repeats + trivial.repeats);
const rows = [];
let done = 0;

function record(id, path, seed, conc, rep, dir, cliArgs, runEnv) {
  const { report, status } = runOnce(dir, id.split("@")[0], cliArgs, runEnv, timeoutMs);
  const hash = report === null ? "" : canonHash(report.rows);
  rows.push({
    pkg: id.split("@")[0], ver: id.split("@")[1], path, seed, conc, rep,
    rowCount: report === null ? "" : report.rows.length,
    mean: report === null ? "" : fmt(report.mean),
    hash, status,
  });
  done += 1;
  console.error(`[${done}/${total}] ${id} ${path} seed=${seed} conc=${conc} rep=${rep}: ${status}${hash ? ` ${hash.slice(0, 12)}` : ""}`);
}

for (const id of ids) {
  const dir = join(args.cache, id);
  for (const seed of seeds) {
    for (const conc of concurrency) {
      for (let rep = 1; rep <= repeats; rep++) {
        record(id, "mock", seed, conc, rep, dir, [
          "run", "--provider", "mock", "--model", config.mockArm.model,
          "--json", "--seed", String(seed), "--concurrency", String(conc),
        ], env);
      }
    }
  }
}

const port = await freePort();
const server = spawn("python3", [SERVER, "--port", String(port)], { stdio: ["ignore", "ignore", "inherit"] });
await waitForServer(port, server);
console.error(`determinism: policy server on port ${port}`);
const trivialEnv = { ...env, OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`, OPENAI_API_KEY: "trivial" };
try {
  for (const id of ids) {
    const dir = join(args.cache, id);
    for (let rep = 1; rep <= trivial.repeats; rep++) {
      record(id, "trivial-server", trivial.seed, trivial.concurrency, rep, dir, [
        "run", "--provider", "openai", "--model", trivial.model,
        "--json", "--seed", String(trivial.seed), "--concurrency", String(trivial.concurrency),
      ], trivialEnv);
    }
  }
} finally {
  server.kill();
}

const groups = new Map();
for (const row of rows) {
  const key = `${row.pkg}|${row.path}|${row.seed}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
for (const group of groups.values()) {
  const uniform = group.every((row) => row.hash !== "") &&
    new Set(group.map((row) => row.hash)).size === 1;
  for (const row of group) row.uniform = uniform ? "yes" : "no";
}

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "determinism.csv"), [
  "package,version,path,seed,concurrency,repeat,rows,mean,sha256,status,uniform,node_version",
  ...rows.map((row) => [row.pkg, row.ver, row.path, row.seed, row.conc, row.rep, row.rowCount, row.mean, row.hash, row.status, row.uniform, nodeVersion].map(csvField).join(",")),
].join("\n") + "\n");

const mockPkgs = ids.filter((id) =>
  rows.filter((row) => row.pkg === id.split("@")[0] && row.path === "mock").every((row) => row.uniform === "yes"));
const trivPkgs = ids.filter((id) =>
  rows.filter((row) => row.pkg === id.split("@")[0] && row.path === "trivial-server").every((row) => row.uniform === "yes"));
const failed = rows.filter((row) => row.status === "failed" || row.status === "timeout");
const drifted = ids.filter((id) => !mockPkgs.includes(id) || !trivPkgs.includes(id)).map((id) => id.split("@")[0]);

console.log(`determinism: ${rows.length} runs on ${ids.length} packages, node ${nodeVersion}`);
console.log(`mock arm: ${mockPkgs.length}/${ids.length} packages byte-identical per seed across concurrency ${concurrency.join("/")} x ${repeats} repeats`);
console.log(`trivial-server arm: ${trivPkgs.length}/${ids.length} packages byte-identical across ${trivial.repeats} repeats (${trivial.model})`);
console.log(`drifted packages: ${drifted.length ? drifted.join(", ") : "none"}`);
console.log(`failed or timed-out runs: ${failed.length}${failed.length ? ` (${failed.map((r) => `${r.pkg} seed=${r.seed} conc=${r.conc} rep=${r.rep} ${r.status}`).join("; ")})` : ""}`);
