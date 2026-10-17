#!/usr/bin/env node
// Standalone check for the frozen E1 reason classes. Loads
// scripts/exp/reason-classes.json, compiles every regex, confirms each
// rule's class is one of the four classMeanings keys, and verifies the
// table covers every package pinned in scripts/exp/versions.json.
//
//   node scripts/exp/check-reason-classes.mjs

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLASSES = join(ROOT, "scripts/exp/reason-classes.json");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const EXPECTED = ["format-gate", "contract-violation", "wrong-answer", "abort"];

function fail(message) {
  console.error(`check-reason-classes: ${message}`);
  process.exit(1);
}

const table = JSON.parse(readFileSync(CLASSES, "utf8"));
const versions = JSON.parse(readFileSync(VERSIONS, "utf8"));

const declared = Object.keys(table.classMeanings ?? {}).sort();
if (JSON.stringify(declared) !== JSON.stringify([...EXPECTED].sort())) {
  fail(`classMeanings keys are ${declared.join(", ")}, expected ${EXPECTED.join(", ")}`);
}
const valid = new Set(declared);

let rules = 0;
function checkRule(where, index, rule) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    fail(`${where}[${index}] is not an object`);
  }
  if (typeof rule.class !== "string" || typeof rule.pattern !== "string") {
    fail(`${where}[${index}] lacks a string class or pattern`);
  }
  if (!valid.has(rule.class)) fail(`${where}[${index}] uses undeclared class ${rule.class}`);
  try {
    new RegExp(rule.pattern);
  } catch (error) {
    fail(`${where}[${index}] pattern does not compile: ${rule.pattern} (${error.message})`);
  }
  rules++;
}

(table.shared ?? []).forEach((rule, i) => checkRule("shared", i, rule));

const pinned = [...new Set(versions.artifacts.map((a) => a.name))].sort();
const mapped = Object.keys(table.packages ?? {}).sort();
const missing = pinned.filter((p) => !mapped.includes(p));
const extra = mapped.filter((p) => !pinned.includes(p));
if (missing.length || extra.length) {
  fail(`package coverage differs from versions.json: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}`);
}
for (const pkg of mapped) {
  const list = table.packages[pkg];
  if (!Array.isArray(list) || list.length === 0) fail(`${pkg} has no rules`);
  list.forEach((rule, i) => checkRule(pkg, i, rule));
}

console.log(`check-reason-classes.mjs: ${rules} rules over ${mapped.length} packages, all regexes compile, all classes declared`);
console.log("check-reason-classes.mjs: all checks passed");
