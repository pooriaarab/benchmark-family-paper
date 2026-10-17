#!/usr/bin/env node
// Prove the section reorder moved text byte-for-byte: concatenate every
// file main.tex inputs, before (git ref) and after (worktree), ignore
// file boundaries, heading levels, comments and \ref targets, then
// compare the two paragraph multisets. The only allowed deltas are the
// cut index.tex paragraphs, the one index sentence re-used in the
// reproducibility appendix, and the stub sentences in the placeholder
// sections. Usage: node scripts/moved-text-check.mjs [base-ref]

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "origin/main";

// Placeholder sections added by the reorder; their prose is allowed to
// appear on the "added" side of the diff.
const STUB_FILES = [
  "sections/verification-layers.tex",
  "sections/grader-soundness.tex",
  "sections/app-review-stats.tex",
  "sections/app-experiments.tex",
  "sections/app-deviations.tex",
  // One pointer sentence added under the builders appendix heading.
  "sections/app-builders.tex",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function gitShow(ref, path) {
  return execSync(`git show ${ref}:${path}`, { cwd: root, encoding: "utf8" });
}

function inputPaths(mainText) {
  const paths = [];
  for (const line of mainText.split("\n")) {
    const m = line.match(/^\\input\{([^}]+)\}/);
    if (m) paths.push(m[1]);
  }
  return paths;
}

// Heading levels, labels, comments and reference targets are structural;
// this check is about the prose itself.
function normalize(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    if (line.startsWith("%")) continue;
    if (/^\\(appendix|section|subsection|paragraph)\b/.test(line) && !line.includes(" ")) {
      // A lone heading command line such as "\appendix".
      continue;
    }
    let s = line;
    s = s.replace(/^\\(section|subsection)\{[^}]*\}/, "");
    s = s.replace(/\\label\{[^}]*\}/g, "");
    s = s.replace(/\\ref\{[^}]*\}/g, "\\ref");
    s = s.replace(/\b(?:Sections?|Appendix|Appendices)(?=~\\ref)/g, "X");
    out.push(s.trim());
  }
  return out.join("\n");
}

function paragraphs(fileTexts) {
  const text = fileTexts.join("\n\n");
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function multiset(list) {
  const map = new Map();
  for (const item of list) map.set(item, (map.get(item) || 0) + 1);
  return map;
}

function diffMultiset(before, after) {
  const removed = new Map(before);
  const added = new Map();
  for (const [p, n] of after) {
    const have = removed.get(p) || 0;
    if (n > have) added.set(p, n - have);
    if (have > 0) removed.set(p, have - Math.min(have, n));
    if (removed.get(p) === 0) removed.delete(p);
  }
  return { removed, added };
}

function main() {
  const oldMain = gitShow(BASE, "paper/main.tex");
  const newMain = readFileSync(join(root, "paper/main.tex"), "utf8");

  const oldTexts = inputPaths(oldMain).map((p) => {
    try {
      return normalize(gitShow(BASE, `paper/${p}`));
    } catch {
      fail(`base ${BASE} has no ${p}`);
    }
  });
  const newTexts = inputPaths(newMain).map((p) => {
    try {
      return normalize(readFileSync(join(root, "paper", p), "utf8"));
    } catch {
      fail(`worktree is missing ${p}`);
    }
  });

  const before = multiset(paragraphs(oldTexts));
  const after = multiset(paragraphs(newTexts));
  const { removed, added } = diffMultiset(before, after);

  // What may be removed: the paragraphs of the cut index section.
  const cutAllowed = new Set(
    paragraphs([normalize(gitShow(BASE, "paper/sections/index.tex"))]),
  );
  // What may be added: stub sentences from the placeholder files, plus
  // any sentence that survives inside a removed paragraph (the one
  // index sentence moved into the reproducibility appendix).
  const stubAllowed = new Set(
    paragraphs(
      STUB_FILES.map((p) => normalize(readFileSync(join(root, "paper", p), "utf8"))),
    ),
  );
  const removedKeys = [...removed.keys()];

  let bad = 0;
  for (const p of removedKeys) {
    if (!cutAllowed.has(p)) {
      bad++;
      console.error(`unexpected removal: ${p.slice(0, 120)}...`);
    }
  }
  for (const p of added.keys()) {
    const reused = removedKeys.some((r) => r.includes(p));
    if (!stubAllowed.has(p) && !reused) {
      bad++;
      console.error(`unexpected addition: ${p.slice(0, 120)}...`);
    }
  }
  if (bad) fail(`moved-text check: ${bad} unexpected paragraph delta(s)`);

  const removedCount = [...removed.values()].reduce((a, b) => a + b, 0);
  const addedCount = [...added.values()].reduce((a, b) => a + b, 0);
  const hash = (list) =>
    createHash("sha256").update([...list].sort().join("\n")).digest("hex").slice(0, 16);
  console.log(`moved-text check vs ${BASE}`);
  console.log(`paragraphs: ${removedCount} removed (index section), ${addedCount} added (stubs + reused sentence)`);
  for (const p of added.keys()) console.log(`+ ${p.slice(0, 100)}`);
  for (const p of removedKeys) console.log(`- ${p.slice(0, 100)}`);
  console.log(`sha256(normalized before)=${hash(before.keys())}`);
  console.log(`sha256(normalized after)=${hash(after.keys())}`);
  console.log("all moved text byte-identical -> ok");
}

main();
