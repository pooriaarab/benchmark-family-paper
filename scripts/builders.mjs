#!/usr/bin/env node
// Rebuild paper/data/builders.csv (Assisted-by trailers per PR class) and
// paper/data/reviewers.csv (reviews per account) from the pull-request
// record of the 22 benchmark repositories. Read-only: never pushes,
// comments, or edits a repository.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outBuilders = join(root, "paper/data/builders.csv");
const outReviewers = join(root, "paper/data/reviewers.csv");
const CHORE = /^Add (CITATION|the Zenodo DOI)|^Publish to ants\.land/;
const TRAILER = /^Assisted-by:\s*(\S+)\s*$/gm;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    console.error(`builders: ${cmd} ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
    process.exit(1);
  }
  return r.stdout;
}

const repos = readFileSync(join(root, "paper/data/suite.txt"), "utf8")
  .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// PR classes: merged feature, merged chore (title prefix), closed, open.
const agents = new Map();
let prsTotal = 0;
for (const repo of repos) {
  const prs = JSON.parse(run("gh", [
    "pr", "list", "-R", `pooriaarab/${repo}`, "--state", "all",
    "--limit", "1000", "--json", "number,title,state,mergedAt,body",
  ]));
  prsTotal += prs.length;
  for (const pr of prs) {
    let col = "closed";
    if (pr.state === "MERGED" || pr.mergedAt) {
      const title = pr.title.replace(/^\[[A-Z]+-\d+\]\s*/, "");
      col = CHORE.test(title) ? "merged_chore" : "merged_feature";
    } else if (pr.state === "OPEN") col = "open";
    for (const m of (pr.body || "").matchAll(TRAILER)) {
      const row = agents.get(m[1]) || { merged_feature: 0, merged_chore: 0, closed: 0, open: 0 };
      row[col] += 1;
      agents.set(m[1], row);
    }
  }
  console.error(`counted ${prs.length} PRs in ${repo}`);
}
const agentRows = [...agents.entries()]
  .map(([agent, c]) => `${agent},${c.merged_feature},${c.merged_chore},${c.closed},${c.open},${c.merged_feature + c.merged_chore + c.closed + c.open}`)
  .sort((a, b) => Number(b.split(",").at(-1)) - Number(a.split(",").at(-1)) || a.localeCompare(b));

// Reviews per account via GraphQL (deduped per PR for prs_reviewed).
const reviews = new Map();
const prsReviewed = new Map();
for (const repo of repos) {
  let cursor = null;
  for (;;) {
    const query = `query($repo:String!,$cursor:String){repository(owner:"pooriaarab",name:$repo){pullRequests(first:100,after:$cursor,states:[OPEN,CLOSED,MERGED]){pageInfo{hasNextPage,endCursor} nodes{reviews(first:100){nodes{author{login}}}}}}}`;
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", `repo=${repo}`];
    if (cursor) args.push("-F", `cursor=${cursor}`);
    const data = JSON.parse(run("gh", args)).data.repository.pullRequests;
    for (const node of data.nodes) {
      const seen = new Set();
      for (const review of node.reviews.nodes) {
        const login = review.author?.login || "unknown";
        reviews.set(login, (reviews.get(login) || 0) + 1);
        seen.add(login);
      }
      for (const login of seen) prsReviewed.set(login, (prsReviewed.get(login) || 0) + 1);
    }
    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }
}
const reviewerRows = [...reviews.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([account, n]) => `${account},${n},${prsReviewed.get(account) || 0},${prsTotal}`);

writeFileSync(outBuilders, `agent,merged_feature,merged_chore,closed,open,total\n${agentRows.join("\n")}\n`);
writeFileSync(outReviewers, `account,reviews,prs_reviewed,prs_total\n${reviewerRows.join("\n")}\n`);
console.log(`${agents.size} trailers, ${prsTotal} PRs -> builders.csv; ${reviews.size} accounts -> reviewers.csv, ok`);
