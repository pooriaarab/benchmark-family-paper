#!/usr/bin/env node
// Fetch the official DMLR style archive and extract only dmlr2e.sty into
// paper/dmlr/. https://data.mlr.press/submissions.html links the template
// at github.com/JmlrOrg/dmlr-style-file; the URL below pins commit
// 2f4c3dc (the tip of main on 2026-10-17). The style is gitignored on
// purpose: download from the venue, never commit. `make dmlr` runs this.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const STYLE_URL =
  "https://github.com/JmlrOrg/dmlr-style-file/archive/2f4c3dc023ecb66d12f653a75554b6269256a825.zip";
// The submissions page offers no hash. SHA-256 of the zip measured on
// first download (2026-10-17). If GitHub re-issues the archive, verify
// the contents, then update this constant.
const STYLE_SHA256 =
  "dee8b52cbc4df5a10b1f69478f10790e9575ff118af6e3a19aaf43c1d6a50fdf";
const WANT = "dmlr2e.sty";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "paper", "dmlr", WANT);

function fail(message) {
  console.error(`fetch-dmlr-style: ${message}`);
  process.exit(1);
}

async function fetchZip() {
  let res;
  try {
    res = await fetch(STYLE_URL, { redirect: "follow" });
  } catch (error) {
    fail(`cannot reach github.com: ${error.message}`);
  }
  if (res.status !== 200) {
    fail(`GET ${STYLE_URL} returned HTTP ${res.status}`);
  }
  const zip = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(zip).digest("hex");
  console.log(`sha256 ${sha}`);
  if (sha !== STYLE_SHA256) {
    fail(
      `zip hash ${sha} does not match pinned ${STYLE_SHA256}; ` +
        "verify the new archive, then update STYLE_SHA256",
    );
  }
  return zip;
}

// Minimal zip reader: find the end-of-central-directory record, walk the
// central directory for WANT, then inflate that one member. Stored
// (method 0) is handled too.
function extractMember(zip, name) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65558); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("downloaded file is not a zip (no end-of-central-directory)");
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) fail("corrupt central directory");
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const member = zip.slice(offset + 46, offset + 46 + nameLen).toString("utf8");
    if (member === name || member.endsWith(`/${name}`)) {
      if (zip.readUInt32LE(local) !== 0x04034b50) fail(`corrupt local header for ${name}`);
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtraLen = zip.readUInt16LE(local + 28);
      const data = zip.slice(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + compressed);
      if (method === 0) return data;
      if (method === 8) {
        try {
          return inflateRawSync(data);
        } catch (error) {
          fail(`cannot inflate ${name}: ${error.message}`);
        }
      }
      fail(`${name} uses unsupported zip method ${method}`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  fail(`${name} not found in ${STYLE_URL}`);
}

const zip = await fetchZip();
const sty = extractMember(zip, WANT);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, sty);
console.log(`${WANT} ${sty.length} bytes -> fetch-dmlr-style, ok`);
