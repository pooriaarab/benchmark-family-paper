#!/usr/bin/env node
// Rebuild the council-review counts behind Section "Separate probing
// review" from the live GitHub record of the 22 benchmark
// repositories. Read-only: never pushes, comments, or edits.
//
// Outputs:
//   paper/data/council.csv          metric,value,note (one row per count)
//   paper/data/council-prs.csv      one row per merged feature PR
//   paper/data/council-reviews.csv  one row per council review, with the
//                                   regex severity flag
//   paper/data/council-sample.csv   deterministic sample of reviews for
//                                   the manual regex check; a `manual`
//                                   column already filled in is kept.
//   paper/data/council-read.csv     hand-read corrections to the regex:
//                                   rows marked `miss` flag reviews the
//                                   regex lost, `false_positive` rows it
//                                   wrongly counted.
//
// Method notes live in paper/data/README.md. Counts derived from the
// severity regex are estimates; the sample and read files record the
// hand checks.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "paper/data");
const outSummary = join(dataDir, "council.csv");
const outPrs = join(dataDir, "council-prs.csv");
const outReviews = join(dataDir, "council-reviews.csv");
const outSample = join(dataDir, "council-sample.csv");
const readPath = join(dataDir, "council-read.csv");

// Same merged-chore rule as scripts/builders.mjs.
const CHORE = /^Add (CITATION|the Zenodo DOI)|^Publish to ants\.land/;
const COUNCIL = "claude";
const CHECKS = ["vibecodereview", "check"];
const SAMPLE_SIZE = 50;

// A review "raises" a severity item when a bold span in its body names
// Critical or Major and presents the item as outstanding: the chair
// writes labels such as "**Open (Major, not fixed):**", "**Major
// (open):**", or "**Major found:**" for items handed to the author, and
// "**Fixed (Major):**" for items it repaired inside the review itself.
// Only the outstanding labels count. Negations ("No Critical or Major
// defects found") appear as plain text and never match. This is an
// estimate; council-sample.csv carries the hand check.
const SEVERITY_STATUS = /\b(open|not fixed|remains|found|new)\b/i;
function flagsSeverity(body) {
  for (const match of String(body).matchAll(/\*\*([^*\n]+)\*\*/g)) {
    const span = match[1];
    if (!/\b(critical|major)\b/i.test(span)) continue;
    if (!SEVERITY_STATUS.test(span)) continue;
    if (/\bno\b[^*]{0,40}\b(critical|major)\b/i.test(span)) continue;
    return true;
  }
  return false;
}

function fail(message) {
  console.error(`council: ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    fail(`${cmd} ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  return r.stdout;
}

function ghGraphql(query, vars) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(vars)) args.push("-F", `${key}=${value}`);
  return JSON.parse(run("gh", args)).data;
}

// All completed runs of each named check on a commit. A re-run on the
// same head posts a second run, so we keep both the latest conclusion
// and whether any run concluded failure. filter=all is required: the
// default filter=latest drops a failed run once a re-run exists (the
// failed vibecodereview run on benchmark-honesty#16 is hidden that way).
function checkRuns(repo, sha) {
  const data = JSON.parse(run("gh", [
    "api", `repos/pooriaarab/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`,
  ]));
  const byName = new Map();
  for (const cr of data.check_runs || []) {
    if (cr.status !== "completed") continue;
    const prev = byName.get(cr.name) || { latest: null, anyFailure: false };
    if (!prev.latest || cr.id > prev.latest.id) prev.latest = cr;
    if (cr.conclusion === "failure") prev.anyFailure = true;
    byName.set(cr.name, prev);
  }
  return byName;
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function main() {
  const repos = readFileSync(join(dataDir, "suite.txt"), "utf8")
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (repos.length === 0) fail("suite.txt is empty");

  const prs = [];
  const reviews = [];
  for (const repo of repos) {
    let cursor = null;
    for (;;) {
      const query = `query($repo:String!,$cursor:String){repository(owner:"pooriaarab",name:$repo){pullRequests(first:100,after:$cursor,states:[OPEN,CLOSED,MERGED]){pageInfo{hasNextPage,endCursor} nodes{number title state mergedAt headRefOid reviews(first:100){nodes{author{login} state body submittedAt}}}}}}`;
      const vars = { repo };
      if (cursor) vars.cursor = cursor;
      const page = ghGraphql(query, vars).repository.pullRequests;
      for (const node of page.nodes) {
        const title = node.title.replace(/^\[[A-Z]+-\d+\]\s*/, "");
        const cls = node.state === "MERGED" || node.mergedAt
          ? (CHORE.test(title) ? "merged_chore" : "merged_feature")
          : node.state === "OPEN" ? "open" : "closed";
        const council = node.reviews.nodes.filter((r) => (r.author?.login || "") === COUNCIL);
        prs.push({
          repo, number: node.number, cls, head: node.headRefOid,
          councilCount: council.length,
          approved: council.some((r) => r.state === "APPROVED"),
        });
        council.forEach((r, i) => reviews.push({
          repo, pr: node.number, cls, index: i,
          state: r.state,
          submittedAt: r.submittedAt || "",
          body: r.body || "",
          severity: flagsSeverity(r.body) ? 1 : 0,
          excerpt: String(r.body || "").replace(/\s+/g, " ").slice(0, 240),
        }));
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
    console.error(`read ${repo}`);
  }

  const mergedFeature = prs.filter((pr) => pr.cls === "merged_feature");
  for (const pr of mergedFeature) {
    const runs = checkRuns(pr.repo, pr.head);
    for (const name of CHECKS) {
      pr[`check_${name}`] = runs.get(name)?.latest?.conclusion || "none";
      pr[`check_${name}_any_failure`] = runs.get(name)?.anyFailure ? 1 : 0;
    }
    // A failed `check` run on an earlier commit of the request does not
    // show on the merge head; count those separately.
    const commits = run("gh", [
      "api", `repos/pooriaarab/${pr.repo}/pulls/${pr.number}/commits?per_page=100`,
      "--jq", ".[].sha",
    ]).trim().split("\n").filter(Boolean);
    let earlierCheckFail = 0;
    for (const sha of commits) {
      if (sha === pr.head) continue;
      const earlier = checkRuns(pr.repo, sha).get("check");
      if (earlier?.anyFailure) earlierCheckFail = 1;
    }
    pr.check_check_earlier_failure = earlierCheckFail;
  }

  const stateCount = (s) => reviews.filter((r) => r.state === s).length;
  const noReview = mergedFeature.filter((pr) => pr.councilCount === 0);
  const neverApproved = mergedFeature.filter((pr) => pr.councilCount > 0 && !pr.approved);
  const approved = mergedFeature.filter((pr) => pr.approved);
  const anyCouncilFail = mergedFeature.filter((pr) => pr.check_vibecodereview_any_failure === 1);
  const lastCouncilFail = mergedFeature.filter((pr) => pr.check_vibecodereview === "failure");
  const lastTestFail = mergedFeature.filter((pr) => pr.check_check === "failure");
  const earlierTestFail = mergedFeature.filter((pr) => pr.check_check_earlier_failure === 1);
  const severityReviews = reviews.filter((r) => r.severity === 1);
  const severityPrs = new Set(severityReviews.map((r) => `${r.repo}#${r.pr}`));
  const councilPrs = new Set(reviews.map((r) => `${r.repo}#${r.pr}`));

  // Severity counts split by PR class, plus how many approved merged
  // feature PRs carry a flagged review.
  const sevOnFeature = severityReviews.filter((r) => r.cls === "merged_feature");
  const sevOnChore = severityReviews.filter((r) => r.cls === "merged_chore");
  const sevFeaturePrs = new Set(sevOnFeature.map((r) => `${r.repo}#${r.pr}`));
  const approvedWithSev = mergedFeature.filter((pr) =>
    pr.approved && sevFeaturePrs.has(`${pr.repo}#${pr.number}`));

  // Hand-read corrections: council-read.csv lists review ids the regex
  // missed (verdict `miss`) and ones it wrongly flagged
  // (`false_positive`), recorded after reading the review bodies.
  const corrections = [];
  if (existsSync(readPath)) {
    for (const line of readFileSync(readPath, "utf8").split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const [repo, pr, index, verdict] = line.split(",");
      const review = reviews.find((r) =>
        r.repo === repo && r.pr === Number(pr) && r.index === Number(index));
      corrections.push({ repo, pr: Number(pr), index: Number(index), verdict, review });
    }
  }
  const missed = corrections.filter((c) => c.verdict === "miss");
  const falsePositives = corrections.filter((c) => c.verdict === "false_positive");
  const sevFull = severityReviews.length - falsePositives.length + missed.length;
  const sevFullPrs = new Set(severityPrs);
  for (const c of missed) sevFullPrs.add(`${c.repo}#${c.pr}`);
  for (const c of falsePositives) {
    if (!severityReviews.some((r) => r.repo === c.repo && r.pr === c.pr
      && !(r.index === c.index))) {
      sevFullPrs.delete(`${c.repo}#${c.pr}`);
    }
  }

  // Keep any manual verdicts already written for the sample.
  const manual = new Map();
  if (existsSync(outSample)) {
    for (const line of readFileSync(outSample, "utf8").split(/\r?\n/).slice(1)) {
      const cols = line.split(",");
      if (cols.length >= 5 && cols[4]) manual.set(`${cols[0]}#${cols[1]}:${cols[2]}`, cols[4]);
    }
  }
  // Deterministic sample: sort by (repo, pr, index), stride to 50.
  const sorted = [...reviews].sort((a, b) =>
    a.repo.localeCompare(b.repo) || a.pr - b.pr || a.index - b.index);
  const stride = sorted.length / SAMPLE_SIZE;
  const sample = [];
  for (let i = 0; i < SAMPLE_SIZE && Math.floor(i * stride) < sorted.length; i++) {
    sample.push(sorted[Math.floor(i * stride)]);
  }

  const metrics = [
    ["prs_total", prs.length, "all pull requests in the 22 repos"],
    ["council_reviews", reviews.length, `reviews authored by the ${COUNCIL} account`],
    ["council_prs_reviewed", councilPrs.size, "PRs with at least one council review"],
    ["reviews_approved", stateCount("APPROVED"), "council reviews with state APPROVED"],
    ["reviews_commented", stateCount("COMMENTED"), "council reviews with state COMMENTED"],
    ["reviews_changes_requested", stateCount("CHANGES_REQUESTED"), "council reviews with state CHANGES_REQUESTED"],
    ["merged_feature", mergedFeature.length, "merged PRs whose title is not a chore"],
    ["merged_no_council_review", noReview.length, "merged feature PRs with zero council reviews"],
    ["merged_never_approved", neverApproved.length, "merged feature PRs reviewed but never APPROVED"],
    ["merged_approved", approved.length, "merged feature PRs with at least one APPROVED"],
    ["merged_council_check_failure", anyCouncilFail.length, "merged feature PRs on whose merge head a vibecodereview run concluded failure"],
    ["merged_council_check_last_failure", lastCouncilFail.length, "of those; PRs whose latest vibecodereview run still concluded failure"],
    ["merged_test_job_failure", lastTestFail.length, "merged feature PRs on whose merge head the latest ci `check` run concluded failure"],
    ["merged_test_job_earlier_failure", earlierTestFail.length, "merged feature PRs where a `check` run failed on an earlier commit of the request"],
    ["reviews_flagging_severity", `~${severityReviews.length}`, "regex estimate: reviews raising an open Critical or Major item"],
    ["prs_with_severity", `~${severityPrs.size}`, "regex estimate: distinct PRs those reviews sit on"],
    ["severity_merged_feature_reviews", sevOnFeature.length, "regex-flagged reviews on merged feature PRs"],
    ["severity_merged_feature_prs", sevFeaturePrs.size, "distinct merged feature PRs with a flagged review"],
    ["severity_approved_feature_prs", approvedWithSev.length, "approved merged feature PRs with a flagged review"],
    ["severity_chore_reviews", sevOnChore.length, "regex-flagged reviews on merged chore PRs"],
    ["reviews_flagging_severity_read", `~${sevFull}`, "hand-read estimate: regex count minus false positives plus missed reviews"],
    ["prs_with_severity_read", `~${sevFullPrs.size}`, "distinct PRs after the hand-read corrections"],
    ["sample_size", sample.length, "deterministic stride sample for the hand check"],
  ];

  // council.csv stays in the collector's plain-split format: no commas
  // or quotes inside fields, semicolons only.
  writeFileSync(outSummary,
    `metric,value,note\n${metrics.map((r) =>
      r.map((v) => String(v).replaceAll(",", ";")).join(",")).join("\n")}\n`);
  writeFileSync(outPrs,
    `repo,pr,class,council_reviews,approved,vibecodereview_latest,vibecodereview_any_failure,check_latest,check_any_failure,check_earlier_failure\n${mergedFeature.map((pr) =>
      [pr.repo, pr.number, pr.cls, pr.councilCount, pr.approved ? 1 : 0,
        pr.check_vibecodereview, pr.check_vibecodereview_any_failure,
        pr.check_check, pr.check_check_any_failure,
        pr.check_check_earlier_failure].map(csvField).join(",")).join("\n")}\n`);
  writeFileSync(outReviews,
    `repo,pr,class,review_index,state,submitted_at,regex_severity,excerpt\n${reviews.map((r) =>
      [r.repo, r.pr, r.cls, r.index, r.state, r.submittedAt, r.severity, r.excerpt]
        .map(csvField).join(",")).join("\n")}\n`);
  // The sample file keeps the full body so the hand check needs no API.
  writeFileSync(outSample,
    `repo,pr,review_index,regex_severity,manual,body\n${sample.map((r) =>
      [r.repo, r.pr, r.index, r.severity, manual.get(`${r.repo}#${r.pr}:${r.index}`) || "", r.body]
        .map(csvField).join(",")).join("\n")}\n`);

  console.log(metrics.map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`-> ${outSummary.replace(`${root}/`, "")}, council-prs.csv, council-reviews.csv, council-sample.csv, ok`);
}

main();
