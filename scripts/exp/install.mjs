#!/usr/bin/env node
// Install the pinned benchmark artifacts into .exp-cache/.
//
// Each artifact in versions.json gets its own prefix directory
// <cache>/<name>@<version>/ holding a real npm install (dependencies
// resolved, bins linked). The tarball is downloaded from the pinned
// URL and its sha512 is checked against the pinned integrity before
// npm ever sees it; a mismatch aborts the run. An artifact counts as
// installed only when its install.ok marker exists, so a killed run
// just resumes. No arguments installs all 34; name@version arguments
// install a subset. --cache <dir> points at another cache (the
// scaffold test uses a temp dir).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");

function parseArgs(argv) {
  const args = { cache: join(ROOT, ".exp-cache"), only: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cache") {
      args.cache = resolve(argv[++i]);
    } else {
      args.only.push(argv[i]);
    }
  }
  return args;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${url} -> HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function installed(dir, artifact) {
  const marker = join(dir, "install.ok");
  if (!existsSync(marker)) return false;
  try {
    const ok = JSON.parse(readFileSync(marker, "utf8"));
    return ok.name === artifact.name && ok.version === artifact.version &&
      ok.integrity === artifact.integrity;
  } catch {
    return false;
  }
}

async function installOne(cache, artifact) {
  const id = `${artifact.name}@${artifact.version}`;
  const dir = join(cache, id);
  if (installed(dir, artifact)) {
    console.log(`${id}: cached`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}\n");

  const tarball = await download(artifact.tarball);
  const actual = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (actual !== artifact.integrity) {
    console.error(`${id}: INTEGRITY MISMATCH`);
    console.error(`  pinned:   ${artifact.integrity}`);
    console.error(`  actual:   ${actual}`);
    process.exit(1);
  }

  const tmp = join(cache, ".tmp");
  mkdirSync(tmp, { recursive: true });
  const tgz = join(tmp, `${artifact.name}-${artifact.version}.tgz`);
  writeFileSync(tgz, tarball);
  try {
    execFileSync(
      "npm",
      ["install", tgz, "--prefix", dir, "--no-audit", "--no-fund", "--loglevel=error"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  } finally {
    rmSync(tgz, { force: true });
  }
  if (!existsSync(join(dir, "node_modules", artifact.name))) {
    console.error(`${id}: install finished but node_modules/${artifact.name} is missing`);
    process.exit(1);
  }
  writeFileSync(
    join(dir, "install.ok"),
    JSON.stringify({ name: artifact.name, version: artifact.version, integrity: artifact.integrity, installedAt: new Date().toISOString() }) + "\n",
  );
  console.log(`${id}: installed`);
}

const args = parseArgs(process.argv.slice(2));
const doc = JSON.parse(readFileSync(VERSIONS, "utf8"));
let wanted = doc.artifacts;
if (args.only.length) {
  const missing = args.only.filter(
    (id) => !doc.artifacts.some((a) => `${a.name}@${a.version}` === id),
  );
  if (missing.length) {
    console.error(`not pinned in versions.json: ${missing.join(", ")}`);
    process.exit(1);
  }
  wanted = doc.artifacts.filter((a) => args.only.includes(`${a.name}@${a.version}`));
}
mkdirSync(args.cache, { recursive: true });
for (const artifact of wanted) {
  await installOne(args.cache, artifact);
}
console.log(`install.mjs: ${wanted.length} artifact(s) ready in ${args.cache}`);
