#!/usr/bin/env node
// End-to-end check for the E4 contract probe freeze: scripts/exp/probes.json,
// paper/data/exp/probe-applicability.csv, paper/data/exp/oracle-definition.csv.
// - honest-variant probes need >=1 promise_source (package@version:file#line
//   plus a quote found verbatim, whitespace-collapsed, in that file of the
//   installed artifact, --cache default .exp-cache); unpromised-exploratory
//   need none; attacks carry type A or B and the numeric rule of the type
// - the strings DEFECT-CLASSES and REVIEW-PROTOCOL are banned: private docs
//   written after the tarballs
// - the applicability matrix has one row per pinned artifact (package+version),
//   every cell 'yes|exploratory|no - reason' plus optional '| applies-to-tasks:
//   <selector>'; 'yes' on an honest-variant column needs a promise covering
//   that artifact; 'yes' is banned on unpromised-exploratory columns and
//   'exploratory' on attack columns
// - the oracle table has one row per pinned artifact; answer-editing attacks
//   are 'no' where the oracle sends no answer text
// Prints the sha256 of the frozen files, exits nonzero naming every failure.

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROBES = join(ROOT, "scripts/exp/probes.json");
const CSV = join(ROOT, "paper/data/exp/probe-applicability.csv");
const ORACLE = join(ROOT, "paper/data/exp/oracle-definition.csv");
const VERSIONS = join(ROOT, "scripts/exp/versions.json");
const KINDS = new Set(["honest-variant", "unpromised-exploratory", "attack"]);
const RULE_A = /FAIL if score\(probe\) > score\(empty submission on the same task\) \+ 0\.001/;
const RULE_B = /FAIL if score\(probe\) differs from score\(oracle on the same task\) by more than 0\.001/;
const FORBIDDEN = [/DEFECT-CLASSES/, /REVIEW-PROTOCOL/];
const collapse = (s) => s.replace(/\s+/g, " ").trim();

let cacheDir = join(ROOT, ".exp-cache");
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i] === "--cache") cacheDir = resolve(argv[++i]);

const failures = [];
const check = (ok, label) => {
  if (!ok) failures.push(label);
  return ok;
};

const probesText = readFileSync(PROBES, "utf8");
const csvText = readFileSync(CSV, "utf8");
const oracleText = readFileSync(ORACLE, "utf8");
const probes = JSON.parse(probesText);
const versions = JSON.parse(readFileSync(VERSIONS, "utf8"));

for (const re of FORBIDDEN) {
  check(!re.test(probesText), `probes.json: forbidden citation ${re}`);
  check(!re.test(csvText), `probe-applicability.csv: forbidden citation ${re}`);
  check(!re.test(oracleText), `oracle-definition.csv: forbidden citation ${re}`);
}

check(Array.isArray(probes.probes), "probes.json: probes must be an array");
const list = Array.isArray(probes.probes) ? probes.probes : [];
check(list.length > 0, "probes.json: probe list is empty");

const artifactKey = (a) => `${a.name}@${a.version}`;
const pinned = new Map(versions.artifacts.map((a) => [artifactKey(a), a]));
const ids = new Set();
const kindOf = new Map();
const promiseCoverage = new Map(); // probeId -> Set of "pkg@ver"
let cited = 0;
let quotesOk = 0;
for (const p of list) {
  check(typeof p.id === "string" && p.id.length > 0, "probes.json: a probe has no id");
  check(!ids.has(p.id), `probes.json: duplicate probe id ${p.id}`);
  ids.add(p.id);
  check(KINDS.has(p.kind), `probes.json: ${p.id} kind must be honest-variant, unpromised-exploratory, or attack`);
  kindOf.set(p.id, p.kind);
  check(typeof p.transform === "string" && p.transform.length > 40,
    `probes.json: ${p.id} transform missing or too vague`);
  check(typeof p.expected === "string" && /0\.001\b/.test(p.expected),
    `probes.json: ${p.id} expected missing or carries no 0.001 tolerance`);

  const sources = Array.isArray(p.promise_source) ? p.promise_source : [];
  if (p.kind === "honest-variant") {
    check(sources.length > 0, `probes.json: ${p.id} honest variant has no promise_source`);
  } else if (p.kind === "unpromised-exploratory") {
    check(sources.length === 0, `probes.json: ${p.id} unpromised-exploratory must not carry promise_source`);
  } else if (p.kind === "attack") {
    check(p.type === "A" || p.type === "B", `probes.json: ${p.id} attack has no type A or B`);
    if (p.type === "A") check(RULE_A.test(p.expected), `probes.json: ${p.id} type A lacks the empty-submission rule`);
    if (p.type === "B") check(RULE_B.test(p.expected), `probes.json: ${p.id} type B lacks the oracle-delta rule`);
  }

  const covered = new Set();
  for (const s of sources) {
    cited++;
    const key = `${s.package}@${s.version}`;
    covered.add(key);
    check(pinned.has(key), `probes.json: ${p.id} cites unpinned artifact ${key}`);
    check(typeof s.ref === "string" && /^[^:]+\.(md|txt|jsonl|js|ts|mjs):\d+$/.test(s.ref),
      `probes.json: ${p.id} promise_source ${key} ref must be path#line inside the artifact`);
    check(typeof s.quote === "string" && s.quote.length > 10,
      `probes.json: ${p.id} promise_source ${key} has no quoted sentence`);
    const m = /^(.+):(\d+)$/.exec(s.ref ?? "");
    if (!m || !pinned.has(key)) continue;
    if (!existsSync(join(cacheDir, key, "install.ok"))) {
      check(false, `probes.json: ${p.id} cites ${key} which is not installed in ${cacheDir}`);
      continue;
    }
    const file = join(cacheDir, key, "node_modules", s.package, m[1]);
    if (!existsSync(file)) {
      check(false, `probes.json: ${p.id} cites missing file ${key}:${s.ref}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const quote = collapse(s.quote);
    check(collapse(text).includes(quote), `probes.json: ${p.id} quote not found in ${key}:${s.ref}`);
    const lineNo = Number(m[2]);
    const window = collapse(text.split("\n").slice(lineNo - 1, lineNo + 4).join("\n"));
    check(window.includes(quote.slice(0, 40)),
      `probes.json: ${p.id} cited line ${key}:${s.ref} does not start the quote`);
    quotesOk++;
  }
  promiseCoverage.set(p.id, covered);
}

// Applicability matrix: one row per pinned artifact.
const rows = csvText.trim().split("\n").map((r) => r.split(","));
const header = rows[0];
check(header[0] === "package" && header[1] === "version" && header[2] === "shape",
  "probe-applicability.csv: header must start package,version,shape");
const probeCols = header.slice(3);
for (const id of ids) check(probeCols.includes(id), `probe-applicability.csv: probe ${id} has no column`);
for (const col of probeCols) check(ids.has(col), `probe-applicability.csv: column ${col} has no probe in probes.json`);
check(rows.length - 1 === pinned.size,
  `probe-applicability.csv: ${rows.length - 1} rows for ${pinned.size} pinned artifacts`);

let applies = 0;
let exploratory = 0;
let outside = 0;
const seen = new Set();
const verdicts = new Map(); // artifactKey -> {col: verdict}
for (const row of rows.slice(1)) {
  const key = `${row[0]}@${row[1]}`;
  check(pinned.has(key), `probe-applicability.csv: ${key} is not in versions.json`);
  check(!seen.has(key), `probe-applicability.csv: duplicate row for ${key}`);
  seen.add(key);
  check(row.length === header.length,
    `probe-applicability.csv: ${key} has ${row.length} cells for ${header.length} columns`);
  const v = {};
  verdicts.set(key, v);
  for (let c = 3; c < row.length; c++) {
    const col = header[c];
    const m = (row[c] ?? "").match(/^(yes|exploratory|no) - (\S[^|]*?)( \| applies-to-tasks: ([A-Za-z0-9!=_-]+))?$/);
    check(m !== null, `probe-applicability.csv: ${key}/${col} cell must be 'yes|exploratory|no - reason'`);
    if (!m) continue;
    const [, verdict, reason, , scope] = m;
    check(reason.length > 0, `probe-applicability.csv: ${key}/${col} has no reason`);
    v[col] = verdict;
    if (kindOf.get(col) === "attack") {
      check(verdict !== "exploratory", `probe-applicability.csv: ${key}/${col} attack cannot be exploratory`);
    } else if (verdict === "yes") {
      check(kindOf.get(col) === "honest-variant" && promiseCoverage.get(col)?.has(key),
        `probe-applicability.csv: ${key}/${col} is yes but no promise_source covers ${key}`);
    }
    if (verdict === "yes") applies++;
    else if (verdict === "exploratory") exploratory++;
    else outside++;
    check(!scope || /^(family|goal|answer|carrier)[=!]?[A-Za-z0-9_-]+$/.test(scope),
      `probe-applicability.csv: ${key}/${col} has malformed applies-to-tasks selector`);
  }
}

// Oracle table: one row per pinned artifact, answer flag consistent with the
// applicability of answer-editing TYPE B attacks.
const orows = oracleText.trim().split("\n").map((r) => r.split(","));
check(orows[0].join(",") === "package,version,oracle_fields,oracle_sends_answer,graded_carrier,oracle_description",
  "oracle-definition.csv: unexpected header");
check(orows.length - 1 === pinned.size,
  `oracle-definition.csv: ${orows.length - 1} rows for ${pinned.size} pinned artifacts`);
const oseen = new Set();
const answerAttacks = list
  .filter((p) => p.kind === "attack" && /oracle sends answer text/.test(p.transform ?? ""))
  .map((p) => p.id);
for (const row of orows.slice(1)) {
  const key = `${row[0]}@${row[1]}`;
  check(pinned.has(key), `oracle-definition.csv: ${key} is not in versions.json`);
  check(!oseen.has(key), `oracle-definition.csv: duplicate row for ${key}`);
  oseen.add(key);
  check(row.length === 6, `oracle-definition.csv: ${key} has ${row.length} fields for 6 columns`);
  check(row[3] === "yes" || row[3] === "no", `oracle-definition.csv: ${key} oracle_sends_answer must be yes or no`);
  if (row[3] !== "no") continue;
  for (const id of answerAttacks) {
    check(verdicts.get(key)?.[id] === "no",
      `${key}/${id} edits answer text but the oracle sends none: cell must be no`);
  }
}

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
console.log(`probes: ${list.length} (${list.filter((p) => p.kind === "honest-variant").length} honest-variant, ${list.filter((p) => p.kind === "unpromised-exploratory").length} unpromised-exploratory, ${list.filter((p) => p.kind === "attack").length} attack [${list.filter((p) => p.type === "A").length} type A, ${list.filter((p) => p.type === "B").length} type B])`);
console.log(`promise_source: ${cited} citations, ${quotesOk} verified verbatim in cached artifacts`);
console.log(`applicability: ${applies} applies, ${exploratory} exploratory, ${outside} outside contract, ${pinned.size} artifacts x ${list.length} probes`);
console.log(`sha256 probes.json ${sha(PROBES)}`);
console.log(`sha256 probe-applicability.csv ${sha(CSV)}`);
console.log(`sha256 oracle-definition.csv ${sha(ORACLE)}`);
if (failures.length > 0) {
  console.error("probes-check failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("probes-check.mjs: all checks passed");
