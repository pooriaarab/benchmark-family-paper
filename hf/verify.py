#!/usr/bin/env python3
"""Verify the published HF datasets for every package in benchmarks.txt.

For each ``pooria/benchmark-<id>`` dataset this fetches the Hub API, checks the
dataset card parses, the expected files exist and the Croissant endpoint
answers 200, then prints one line per dataset: ``ok`` or the failure.
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

REQUIRED_FILES = {"data/tasks.jsonl", "data/PROVENANCE.md", "README.md",
                  "croissant.json", "LICENSE"}
REQUIRED_CARD_KEYS = ("license", "pretty_name", "tags", "task_categories",
                      "size_categories", "configs")
HF_OWNER = "pooria"


def load_packages() -> list[str]:
    out = []
    for line in (Path(__file__).parent / "benchmarks.txt").read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line if line.startswith("benchmark-") else f"benchmark-{line}")
    return out


def http_get(url: str, token: str | None = None) -> bytes:
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    return urllib.request.urlopen(req, timeout=30).read()


def check(repo_id: str, api, token: str | None) -> str:
    try:
        info = api.dataset_info(repo_id)
    except Exception as exc:
        return f"hub api: {exc}"
    have = {s.rfilename for s in info.siblings}
    missing = REQUIRED_FILES - have
    if missing:
        return f"missing files: {sorted(missing)}"
    try:
        from huggingface_hub import DatasetCard
        card = DatasetCard.load(repo_id, repo_type="dataset", token=token)
        bad = [k for k in REQUIRED_CARD_KEYS if getattr(card.data, k, None) in (None, [])]
        if bad:
            return f"card missing keys: {bad}"
    except Exception as exc:
        return f"card parse: {exc}"
    try:
        http_get(f"https://huggingface.co/api/datasets/{repo_id}/croissant")
    except Exception as exc:
        return f"croissant endpoint: {exc}"
    return "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", metavar="ID", help="check a single benchmark-<id>")
    args = ap.parse_args()
    import os
    from huggingface_hub import HfApi
    token = os.environ.get("HF_TOKEN")
    token_file = Path.home() / ".config" / "agents" / "hf-token"
    if not token and token_file.exists():
        token = token_file.read_text().strip()
    api = HfApi(token=token)
    packages = load_packages()
    if args.only:
        want = args.only if args.only.startswith("benchmark-") else f"benchmark-{args.only}"
        packages = [p for p in packages if p == want]
    if not packages:
        print("no packages to verify (check --only and benchmarks.txt)", file=sys.stderr)
        return 1
    failed = 0
    for pkg in packages:
        status = check(f"{HF_OWNER}/{pkg}", api, token)
        print(f"{pkg}: {status}")
        failed += status != "ok"
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
