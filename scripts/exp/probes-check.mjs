#!/usr/bin/env node
// End-to-end check for the E4 contract probe freeze (scripts/exp/probes.json
// and paper/data/exp/probe-applicability.csv). Validates the probe schema,
// requires every probe to carry a numeric expected rule, requires the
// applicability matrix to cover every pinned package and every probe with
// no empty cell, then prints the sha256 of both frozen files. Exits nonzero
// on the first failed check and names it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROBES = join(ROOT, "scripts/exp/probes.json");
const CSV = join(ROOT, "paper/data/exp/probe-applicability.csv");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const KINDS = new Set(["honest-variant", "attack"]);
const TOLERANCE = /0\.001/;

const failures = [];
const check = (ok, label) => {
  if (!ok) failures.push(label);
  return ok;
};

const probes = JSON.parse(readFileSync(PROBES, "utf8"));
const versions = JSON.parse(readFileSync(VERSIONS, "utf8"));
const csvText = readFileSync(CSV, "utf8");

check(Array.isArray(probes.probes), "probes.json: probes must be an array");
const list = probes.probes ?? [];
check(list.length > 0, "probes.json: probe list is empty");

const ids = new Set();
for (const p of list) {
  check(typeof p.id === "string" && p.id.length > 0, "probes.json: a probe has no id");
  check(!ids.has(p.id), `probes.json: duplicate probe id ${p.id}`);
  ids.add(p.id);
  check(KINDS.has(p.kind), `probes.json: ${p.id} kind must be honest-variant or attack`);
  check(typeof p.transform === "string" && p.transform.length > 40,
    `probes.json: ${p.id} transform missing or too vague`);
  check(typeof p.expected === "string" && p.expected.length > 0,
    `probes.json: ${p.id} has no expected value`);
  check(TOLERANCE.test(p.expected),
    `probes.json: ${p.id} expected carries no numeric tolerance`);
  check(p.kind === "attack" || typeof p.source === "string",
    `probes.json: ${p.id} honest variant lacks a contract source`);
}

const rows = csvText.trim().split("\n").map((r) => r.split(","));
const header = rows[0];
check(header[0] === "package", "probe-applicability.csv: first column must be package");
const probeCols = header.slice(header[1] === "shape" ? 2 : 1);
for (const id of ids) {
  check(probeCols.includes(id), `probe-applicability.csv: probe ${id} has no column`);
}
for (const col of probeCols) {
  check(ids.has(col), `probe-applicability.csv: column ${col} has no probe in probes.json`);
}

const pinned = new Set(versions.artifacts.map((a) => a.name));
check(rows.length - 1 === pinned.size,
  `probe-applicability.csv: ${rows.length - 1} rows for ${pinned.size} pinned packages`);

let applies = 0;
let outside = 0;
for (const row of rows.slice(1)) {
  const pkg = row[0];
  check(pinned.has(pkg), `probe-applicability.csv: ${pkg} is not in versions.json`);
  check(row.length === header.length,
    `probe-applicability.csv: ${pkg} has ${row.length} cells for ${header.length} columns`);
  for (let c = header[1] === "shape" ? 2 : 1; c < row.length; c++) {
    const cell = row[c] ?? "";
    const m = cell.match(/^(yes|no) - (\S.*)$/);
    check(m !== null, `probe-applicability.csv: ${pkg}/${header[c]} cell must be 'yes|no - reason'`);
    if (m) {
      check(m[2].length > 0, `probe-applicability.csv: ${pkg}/${header[c]} has no reason`);
      if (m[1] === "yes") applies++;
      else outside++;
    }
  }
}

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
console.log(`probes: ${list.length} (${list.filter((p) => p.kind === "honest-variant").length} honest-variant, ${list.filter((p) => p.kind === "attack").length} attack)`);
console.log(`applicability: ${applies} applies, ${outside} outside contract, ${pinned.size} packages x ${list.length} probes`);
console.log(`sha256 probes.json ${sha(PROBES)}`);
console.log(`sha256 probe-applicability.csv ${sha(CSV)}`);
if (failures.length > 0) {
  console.error("probes-check failures:");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("probes-check.mjs: all checks passed");
