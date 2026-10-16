#!/usr/bin/env node
// Flatten paper/ into arxiv/benchmark-family-arxiv.tar.gz and recompile it.
// No dependencies. Tectonic must be on PATH. `make arxiv` is the entry point.

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paperDir = join(root, "paper");
const outTar = join(root, "arxiv", "benchmark-family-arxiv.tar.gz");

const INPUTS = [
  ["generated/macros.tex", "macros.tex"],
  ["generated/review.tex", "review.tex"],
  ["generated/defects-macros.tex", "defects-macros.tex"],
  ["generated/defects.tex", "defects.tex"],
  ["generated/suite-table.tex", "suite-table.tex"],
  ["generated/graders.tex", "graders.tex"],
  ["generated/mock-table.tex", "mock-table.tex"],
  ["generated/summary.tex", "summary.tex"],
  ["sections/intro.tex", "intro.tex"],
  ["sections/principles.tex", "principles.tex"],
  ["sections/engine.tex", "engine.tex"],
  ["sections/suite.tex", "suite.tex"],
  ["sections/validation.tex", "validation.tex"],
  ["sections/adversarial.tex", "adversarial.tex"],
  ["sections/index.tex", "index.tex"],
  ["sections/related.tex", "related.tex"],
  ["sections/closing.tex", "closing.tex"],
  ["sections/conclusion.tex", "conclusion.tex"],
  ["figures/fig-system.tex", "fig-system.tex"],
  ["figures/fig-mock.tex", "fig-mock.tex"],
  ["figures/fig-defects.tex", "fig-defects.tex"],
  ["figures/fig-rounds.tex", "fig-rounds.tex"],
];

// Figure data ships as flat CSVs; paths inside .tex files are rewritten.
const CSVS = [
  ["data/defects.csv", "defects.csv"],
  ["data/review-rounds.csv", "review-rounds.csv"],
  ["generated/mock-scores.csv", "mock-scores.csv"],
];

const ALLOWED = new Set([".tex", ".bib", ".bbl", ".sty", ".csv"]);
const TECTONIC = process.env.TECTONIC || "tectonic";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.error) fail(`${cmd}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    fail(`${cmd} ${args.join(" ")} exited ${result.status}\n${detail}`);
  }
  return result.stdout;
}

function flattenMain() {
  let main = readFileSync(join(paperDir, "main.tex"), "utf8");
  for (const [from, to] of INPUTS) {
    if (!main.includes(from)) fail(`main.tex does not input ${from}`);
    main = main.replaceAll(from, to);
  }
  main = flattenCsvs(main);
  if (main.includes("sections/") || main.includes("generated/") || main.includes("figures/")) {
    fail("flattened main.tex still has a directory input");
  }
  return main;
}

function flattenCsvs(text) {
  let out = text;
  for (const [from, to] of CSVS) out = out.replaceAll(from, to);
  return out;
}

function flattenInput(from) {
  const text = readFileSync(join(paperDir, from), "utf8");
  return flattenCsvs(text);
}

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function main() {
  // The NeurIPS style is fetched, not committed; refuse early if absent.
  const styPath = join(paperDir, "neurips_2026.sty");
  try {
    statSync(styPath);
  } catch {
    fail("paper/neurips_2026.sty is missing; run `node scripts/fetch-style.mjs` first");
  }
  const buildDir = mkdtempSync(join(tmpdir(), "bfp-build-"));
  const stage = mkdtempSync(join(tmpdir(), "bfp-arxiv-"));
  const proof = mkdtempSync(join(tmpdir(), "bfp-proof-"));
  try {
    run(TECTONIC, ["--keep-intermediates", "--outdir", buildDir, "main.tex"], paperDir);
    const bblPath = join(buildDir, "main.bbl");
    const bbl = readFileSync(bblPath, "utf8");
    if (!bbl.includes("\\bibitem")) fail("main.bbl has no bibitems");
    if (bbl.includes("/home/") || bbl.includes("/tmp/")) fail("main.bbl contains a filesystem path");

    writeFileSync(join(stage, "main.tex"), flattenMain());
    for (const [from, to] of INPUTS) {
      writeFileSync(join(stage, to), flattenInput(from));
    }
    for (const [from, to] of CSVS) {
      writeFileSync(join(stage, to), readFileSync(join(paperDir, from)));
    }
    writeFileSync(join(stage, "refs.bib"), readFileSync(join(paperDir, "refs.bib")));
    writeFileSync(join(stage, "main.bbl"), bbl);
    // arXiv does not carry the NeurIPS style; the tarball must ship it.
    writeFileSync(join(stage, "neurips_2026.sty"), readFileSync(styPath));

    const names = readdirSync(stage).sort();
    for (const name of names) {
      const ext = extensionOf(name);
      if (!ALLOWED.has(ext)) fail(`refusing ${name}: ${ext || "no extension"} is not a source file`);
      if (statSync(join(stage, name)).isDirectory()) fail(`refusing directory ${name}`);
    }

    mkdirSync(dirname(outTar), { recursive: true });
    rmSync(outTar, { force: true });
    run("tar", ["-czf", outTar, "-C", stage, ...names], root);

    run("tar", ["-xzf", outTar, "-C", proof], root);
    const unpacked = readdirSync(proof).sort();
    if (unpacked.join("\n") !== names.join("\n")) fail("unpacked names do not match the stage");
    for (const name of unpacked) {
      if (statSync(join(proof, name)).isDirectory()) fail("tarball is not flat");
    }
    run(TECTONIC, ["main.tex"], proof);
    const pdf = statSync(join(proof, "main.pdf"));
    if (pdf.size < 10000) fail(`proof pdf is only ${pdf.size} bytes`);
    console.log(
      `${names.length} files, bbl ${Buffer.byteLength(bbl)} bytes, proof pdf ${pdf.size} bytes -> arxiv packet, ok`,
    );
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
    rmSync(proof, { recursive: true, force: true });
  }
}

main();
