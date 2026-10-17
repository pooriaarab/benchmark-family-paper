#!/usr/bin/env node
// Regenerate the Title and Abstract blocks in arxiv/SUBMIT.md from
// paper/main.tex so the metadata cannot drift from the paper. Macros are
// expanded from the generated files; run scripts/collect.mjs first if
// they are stale. No dependencies.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const submitPath = join(root, "arxiv/SUBMIT.md");

function fail(message) {
  console.error(`submit-md: ${message}`);
  process.exit(1);
}

const macros = new Map();
for (const name of readdirSync(join(root, "paper/generated")).filter((n) => n.endsWith(".tex"))) {
  for (const m of readFileSync(join(root, "paper/generated", name), "utf8")
    .matchAll(/\\newcommand\{\\([A-Za-z]+)\}\{([^{}]*)\}/g)) {
    macros.set(m[1], m[2]);
  }
}

function plainText(tex) {
  let out = tex;
  for (let i = 0; i < 20; i++) {
    const next = out
      .replace(/\\([A-Za-z]+)\{\}/g, (m, name) => macros.get(name) ?? m)
      .replace(/\\([A-Za-z]+)(?=[^A-Za-z{]|$)/g, (m, name) => macros.get(name) ?? m);
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/\\(?:texttt|path|url|textbf|emph)\{([^{}]*)\}/g, "$1")
    .replace(/``/g, '"').replace(/''/g, '"')
    .replace(/\\([&_#%])/g, "$1")
    .replace(/~/g, " ").replace(/---/g, "--").replace(/\\dots\{\}/g, "...")
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ").trim();
}

const main = readFileSync(join(root, "paper/main.tex"), "utf8");
const title = plainText(main.match(/\\title\{(.+)\}/)?.[1] ?? fail("main.tex has no \\title"));
const abstract = plainText(main.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)?.[1] ?? fail("main.tex has no abstract"));
if (/\\[A-Za-z]/.test(title + abstract)) fail("unexpanded macro left in metadata");

let submit = readFileSync(submitPath, "utf8")
  .replace(
    "Abstract (plain text, macros expanded from the collector that wrote `paper/generated/macros.tex`):",
    "Abstract (plain text, macros expanded by `scripts/submit-md.mjs` from the generated files):",
  )
  .replace(
    "If `suite.txt` gains a package, regenerate the tables and edit the package count in this abstract before uploading.",
    "If `suite.txt` gains a package or the paper text changes, rerun `node scripts/submit-md.mjs`; editing the title or abstract block by hand will drift from `main.tex`.",
  );
function fillBlock(anchor, content) {
  const pattern = new RegExp("(" + anchor + "[^\\n]*\n\n```text\n)[\\s\\S]*?(\n```)");
  if (!pattern.test(submit)) fail(`no fenced block after ${anchor}`);
  submit = submit.replace(pattern, `$1${content}$2`);
}
fillBlock("Title:", title);
fillBlock("Abstract \\(plain text", abstract);
writeFileSync(submitPath, submit);
console.log("title and abstract refreshed in arxiv/SUBMIT.md -> submit-md, ok");
