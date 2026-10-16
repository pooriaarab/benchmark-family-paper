#!/usr/bin/env python3
"""Stage benchmark-* package data for Hugging Face upload.

For every package listed in benchmarks.txt (one ``benchmark-<id>`` per line)
this tool clones ``pooriaarab/<package>`` at ``main``, builds a staging folder
with the public task data, the refresh generator, a dataset card and a
Croissant file (core + minimal RAI fields, per the NeurIPS 2026 Evaluations &
Datasets hosting guidelines).

``--dry-run`` builds and validates every staging folder without touching the
Hub. Without it, each staging folder is uploaded to
``huggingface.co/datasets/pooria/<package>`` (created public if missing), the
Croissant file is merged with what Hugging Face auto-generates, and the
``AI Benchmark Index`` collection under ``pooria`` is kept in sync.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIST_FILE = HERE / "benchmarks.txt"
OUT_DIR = HERE / "out"
GITHUB_ORG = "pooriaarab"
HF_OWNER = "pooria"
COLLECTION_TITLE = "AI Benchmark Index"
TOKEN_FILE = Path.home() / ".config" / "agents" / "hf-token"

# Anything matching this never leaves the GitHub clone: hidden splits,
# credentials, env files. The public split is all that ships.
SECRET_RE = re.compile(
    r"(hidden|secret|private|internal|token|credential|password|apikey|api[_-]?key|holdout)",
    re.IGNORECASE,
)
TAG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SIZE_STEPS = [(1_000, "n<1K"), (10_000, "1K<n<10K"), (100_000, "10K<n<100K"),
              (1_000_000, "100K<n<1M"), (10_000_000, "1M<n<10M")]


def sh(cmd: list[str], cwd: Path | None = None) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, text=True,
                          capture_output=True).stdout


def load_packages(list_file: Path = LIST_FILE) -> list[str]:
    out = []
    for line in list_file.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line if line.startswith("benchmark-") else f"benchmark-{line}")
    return out


def clone_package(pkg: str, dest: Path) -> None:
    sh(["git", "clone", "--depth", "1", "--branch", "main",
        f"https://github.com/{GITHUB_ORG}/{pkg}.git", str(dest)])


def index_entry(pkg: str) -> dict:
    """Facts from `npx <pkg> index-entry --json`, with a repo-file fallback."""
    for argv in (["npx", "-y", pkg, "index-entry", "--json"],
                 ["npx", "-y", pkg, "index-entry"]):
        try:
            return json.loads(sh(argv))
        except (subprocess.CalledProcessError, json.JSONDecodeError, FileNotFoundError):
            continue
    return {}


def task_stats(tasks_file: Path) -> dict:
    """Count tasks, field types and `kind` values from a JSONL file."""
    count, fields, kinds = 0, {}, {}
    for line in tasks_file.read_text().splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        count += 1
        for key, val in obj.items():
            fields.setdefault(key, set()).add(type(val).__name__)
        kinds[obj.get("kind", "?")] = kinds.get(obj.get("kind", "?"), 0) + 1
    type_map = {"str": "string", "int": "number", "float": "number",
                "bool": "boolean", "dict": "object", "list": "array", "NoneType": "null"}
    return {
        "count": count,
        "fields": {k: "/".join(sorted(type_map.get(t, t) for t in v))
                   for k, v in fields.items()},
        "kinds": kinds,
    }


def stage_data(clone_dir: Path, stage_dir: Path) -> list[str]:
    """Copy data/ (minus hidden splits and secrets) and the refresh scripts."""
    copied = []
    src_data = clone_dir / "data"
    if src_data.is_symlink():
        raise SystemExit(f"refusing symlinked data/ in {clone_dir}")
    for src in sorted(src_data.rglob("*")):
        rel = src.relative_to(clone_dir)
        if src.is_symlink() or src.is_dir() or SECRET_RE.search(str(rel)) or any(
                p.startswith(".") for p in rel.parts):
            continue
        dest = stage_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied.append(str(rel))
    scripts = {clone_dir / "scripts" / "gen-tasks.mjs"}
    prov = src_data / "PROVENANCE.md"
    if prov.exists():
        for m in re.findall(r"scripts/[A-Za-z0-9._-]+\.mjs", prov.read_text()):
            scripts.add(clone_dir / m)
    for src in sorted(scripts):
        if src.exists() and not src.is_symlink():
            dest = stage_dir / src.relative_to(clone_dir)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            copied.append(str(src.relative_to(clone_dir)))
    lic = clone_dir / "LICENSE"
    if lic.exists() and not lic.is_symlink():
        shutil.copy2(lic, stage_dir / "LICENSE")
        copied.append("LICENSE")
    return copied


def size_category(n: int) -> str:
    for bound, label in SIZE_STEPS:
        if n < bound:
            return label
    return "10M<n<100M"


def yaml_str(value: str) -> str:
    return json.dumps(value)  # JSON strings are valid YAML flow scalars.


def build_card(pkg: str, entry: dict, stats: dict, provenance: str,
               keywords: list[str], licence: str) -> str:
    name = entry.get("name") or pkg
    tags = ["benchmark", "llm-evaluation"] + [
        k for k in keywords if TAG_RE.match(k) and k not in ("benchmark", "llm-evaluation")]
    fields = "\n".join(f"| `{k}` | {v} |" for k, v in stats["fields"].items())
    kinds = ", ".join(f"{v} {k}" for k, v in sorted(stats["kinds"].items()))
    srcs = ", ".join(sorted({s.get("kind", "?") for s in entry.get("data_sources", [])}))
    fm = ["---", f"license: {yaml_str(str(licence).lower())}", "language:", "- en",
          f"pretty_name: {yaml_str(name)}", "tags:"]
    fm += [f"- {t}" for t in tags]
    fm += ["task_categories:", "- text-generation", "size_categories:",
           f"- {size_category(stats['count'])}", "configs:",
           "- config_name: default", "  data_files:", "  - split: test",
           "    path: data/tasks.jsonl", "---"]
    body = f"""# {name}

{entry.get('tagline', '')}

## What it measures

{entry.get('what_it_measures', '')}

Category: `{entry.get('category', '')}`. Status: `{entry.get('status', 'alpha')}`.

## How to run

```console
$ npx {pkg} list
$ npx {pkg} run --model <model-id> --provider openrouter
$ npx {pkg} score results.json
```

`--provider mock` runs the whole benchmark offline with no keys. Real models run
through OpenRouter (`OPENROUTER_API_KEY`) or any OpenAI-compatible base URL
(`OPENAI_BASE_URL`, `OPENAI_API_KEY`).

## Data fields

`data/tasks.jsonl` holds {stats['count']} tasks, one JSON object per line
(kinds: {kinds}).

| field | type |
|---|---|
{fields}

## Provenance

{provenance}

## Grader

{entry.get('grader', '')}

## Limitations

This dataset contains only the public task split ({stats['count']} tasks).
Hidden evaluation splits use a private seed and are deliberately not part of
this dataset. Source kinds: {srcs or 'synthetic'}. These are evaluation prompts
for the `{pkg}` benchmark, not training data; scoring requires the package's
deterministic grader. See PROVENANCE.md for contamination notes.

## Citation

```bibtex
@misc{{{pkg.replace('-', '_')},
  author = {{Pooria Arab}},
  title = {{{name} task data}},
  year = {{2026}},
  url = {{https://github.com/{GITHUB_ORG}/{pkg}}}
}}
```

## Links

- npm: https://www.npmjs.com/package/{pkg}
- GitHub: https://github.com/{GITHUB_ORG}/{pkg}
- Leaderboard: https://aibenchmarkindex.com/benchmarks/{pkg}
- Dataset: https://huggingface.co/datasets/{HF_OWNER}/{pkg}
"""
    return "\n".join(fm) + "\n\n" + body


def build_croissant(pkg: str, entry: dict, stats: dict, files: list[str],
                    stage_dir: Path) -> dict:
    """Croissant core fields plus the minimal RAI fields NeurIPS requires."""
    name = entry.get("name") or pkg
    repo_url = f"https://github.com/{GITHUB_ORG}/{pkg}"
    hf_url = f"https://huggingface.co/datasets/{HF_OWNER}/{pkg}"
    distribution = []
    for rel in files:
        p = stage_dir / rel
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        fmt = {"jsonl": "application/jsonlines", "json": "application/json",
               "md": "text/markdown", "mjs": "text/javascript"}.get(
                   p.suffix.lstrip("."), "text/plain")
        distribution.append({
            "@type": "cr:FileObject", "@id": rel, "name": rel,
            "contentUrl": f"{hf_url}/resolve/main/{rel}",
            "encodingFormat": fmt, "sha256": digest})
    dtype = {"string": "sc:Text", "number": "sc:Float", "boolean": "sc:Boolean"}
    fields = [{"@type": "cr:Field", "name": k,
               "dataType": dtype.get(v.split("/")[0], "sc:Text"),
               "source": {"fileObject": {"@id": "data/tasks.jsonl"},
                          "extract": {"jsonPath": f"$.{k}"}}}
              for k, v in stats["fields"].items()]
    sources = entry.get("data_sources", [])
    derived = [s["url"] for s in sources if s.get("url")] or [repo_url]
    generated = [{"@type": "prov:Activity", "name": s.get("name", "task generation"),
                  "description": f"{s.get('kind', '?')} source: {s.get('url', '')}"}
                 for s in sources]
    return {
        "@context": {
            "@language": "en", "@vocab": "https://schema.org/",
            "citeAs": "cr:citeAs", "column": "cr:column",
            "conformsTo": "dct:conformsTo",
            "cr": "http://mlcommons.org/croissant/",
            "data": {"@id": "cr:data", "@type": "@json"},
            "dataBiases": "cr:dataBiases", "dataCollection": "cr:dataCollection",
            "dataType": {"@id": "cr:dataType", "@type": "@vocab"},
            "dct": "http://purl.org/dc/terms/", "examples": "cr:examples",
            "extract": "cr:extract", "field": "cr:field",
            "fileProperty": "cr:fileProperty", "fileObject": "cr:fileObject",
            "fileSet": "cr:fileSet", "format": "cr:format",
            "includes": "cr:includes", "isLiveDataset": "cr:isLiveDataset",
            "jsonPath": "cr:jsonPath", "key": "cr:key", "md5": "cr:md5",
            "parentField": "cr:parentField", "path": "cr:path",
            "personalSensitiveInformation": "cr:personalSensitiveInformation",
            "prov": "http://www.w3.org/ns/prov#",
            "rai": "http://mlcommons.org/croissant/RAI/",
            "recordSet": "cr:recordSet", "references": "cr:references",
            "regex": "cr:regex", "repeated": "cr:repeated",
            "replace": "cr:replace", "samplingRate": "cr:samplingRate",
            "sc": "https://schema.org/", "separator": "cr:separator",
            "source": "cr:source", "subField": "cr:subField",
            "transform": "cr:transform",
        },
        "@type": "sc:Dataset",
        "conformsTo": ["http://mlcommons.org/croissant/1.0",
                       "http://mlcommons.org/croissant/RAI/1.0"],
        "name": name, "description": entry.get("tagline", ""),
        "url": hf_url, "sameAs": [repo_url, entry.get("docs", "")],
        "license": "https://choosealicense.com/licenses/mit/",
        "creator": {"@type": "Person", "name": "Pooria Arab",
                    "url": f"https://github.com/{GITHUB_ORG}"},
        "datePublished": entry.get("created", ""),
        "dateModified": entry.get("updated", ""),
        "version": entry.get("version", ""), "inLanguage": "en",
        "keywords": [pkg, "llm-evaluation", "benchmark"],
        "isAccessibleForFree": True,
        "citeAs": (f"@misc{{{pkg}, author={{Pooria Arab}}, title={{{name}}}, "
                   f"year={{2026}}, url={{{repo_url}}}}}"),
        "distribution": distribution,
        "recordSet": [{"@type": "cr:RecordSet", "name": "tasks",
                       "description": f"{stats['count']} benchmark tasks, one JSON object per line.",
                       "field": fields}],
        "rai:dataCollection": ("Public task split cloned from the benchmark repository; "
                               "tasks are produced by scripts/gen-tasks.mjs with a fixed public seed."),
        "rai:dataCollectionType": "Benchmark task prompts for LLM evaluation.",
        "rai:dataCollectionRawData": repo_url + "/tree/main/data",
        "rai:dataReleaseMaintenancePlan": ("Refreshed when the benchmark's public seed changes; "
                                           "hidden splits are generated with a private seed and never published."),
        "rai:dataLimitations": (f"Public split only ({stats['count']} tasks); hidden evaluation splits "
                               "are held out. Evaluation prompts, not training data."),
        "rai:dataBiases": ("Synthetic task families oversample the shapes the generator enumerates; "
                           "coverage of real-world variation is limited by the generator templates."),
        "rai:personalSensitiveInformation": ("None. Tasks contain no personal data; names, orders and "
                                             "scenarios are generated fixtures."),
        "rai:dataUseCases": ["Testing and comparing LLM/agent behaviour on the measured construct",
                             "Regression testing of model releases"],
        "rai:dataSocialImpact": ("Low risk: synthetic eval data. Improves transparency of model "
                                 "capability claims when used responsibly."),
        "rai:hasSyntheticData": any(s.get("kind") == "synthetic" for s in sources),
        "prov:wasDerivedFrom": derived,
        "prov:wasGeneratedBy": generated,
    }


def validate_croissant(path: Path) -> str:
    """Validate with mlcroissant when it is installed; skip cleanly otherwise."""
    try:
        import mlcroissant as mlc  # type: ignore
    except ImportError:
        return "mlcroissant not installed, skipped"
    try:
        mlc.Dataset(jsonld=str(path))
        return "mlcroissant ok"
    except Exception as exc:  # report, do not crash the stage
        return f"mlcroissant warning: {exc}"


def build_stage(pkg: str, work_root: Path) -> dict:
    clone_dir = Path(tempfile.mkdtemp(prefix=f"{pkg}-", dir=work_root))
    clone_package(pkg, clone_dir)
    stage_dir = OUT_DIR / pkg
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)
    files = stage_data(clone_dir, stage_dir)
    tasks = stage_dir / "data" / "tasks.jsonl"
    if not tasks.exists():
        raise RuntimeError(f"{pkg}: no data/tasks.jsonl after staging")
    stats = task_stats(tasks)
    pkg_json = json.loads((clone_dir / "package.json").read_text())
    entry = index_entry(pkg)
    entry.setdefault("name", pkg_json.get("description", pkg))
    entry.setdefault("task_count", stats["count"])
    provenance = (stage_dir / "data" / "PROVENANCE.md").read_text() \
        if (stage_dir / "data" / "PROVENANCE.md").exists() else "See the repository."
    card = build_card(pkg, entry, stats, provenance,
                      pkg_json.get("keywords", []),
                      pkg_json.get("license", "MIT"))
    (stage_dir / "README.md").write_text(card)
    croissant = build_croissant(pkg, entry, stats, files, stage_dir)
    cro_path = stage_dir / "croissant.json"
    cro_path.write_text(json.dumps(croissant, indent=2) + "\n")
    check = validate_croissant(cro_path)
    return {"pkg": pkg, "stage": str(stage_dir), "files": len(files),
            "tasks": stats["count"], "croissant": check}


def hf_api():
    """Authenticated HfApi; token comes from the env or the agent token file."""
    from huggingface_hub import HfApi
    token = os.environ.get("HF_TOKEN")
    if not token and TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text().strip()
    if not token:
        raise RuntimeError("no HF token: set HF_TOKEN or ~/.config/agents/hf-token")
    api = HfApi(token=token)
    who = api.whoami()["name"]
    if who != HF_OWNER:
        raise RuntimeError(f"token belongs to {who}, expected {HF_OWNER}")
    return api


def hf_croissant(repo_id: str) -> dict:
    """What Hugging Face auto-generates for this dataset, if anything."""
    url = f"https://huggingface.co/api/datasets/{repo_id}/croissant"
    try:
        return json.loads(urllib.request.urlopen(url, timeout=30).read())
    except Exception:
        return {}


def merge_croissant(ours: dict, generated: dict) -> tuple[dict, list[str]]:
    """Adopt core fields HF fills in that we do not set; never duplicate."""
    skip = {"@context", "@type", "recordSet", "distribution"}
    added = []
    for key, val in generated.items():
        if key not in skip and key not in ours and val not in (None, "", []):
            ours[key] = val
            added.append(key)
    return ours, added


def upload_dataset(api, pkg: str, stage_dir: Path) -> str:
    repo_id = f"{HF_OWNER}/{pkg}"
    api.create_repo(repo_id, repo_type="dataset", private=False, exist_ok=True)
    api.upload_folder(repo_id=repo_id, folder_path=str(stage_dir),
                      repo_type="dataset",
                      commit_message="Publish benchmark task data")
    generated = hf_croissant(repo_id)
    if generated:
        cro_path = stage_dir / "croissant.json"
        merged, added = merge_croissant(json.loads(cro_path.read_text()), generated)
        if added:
            cro_path.write_text(json.dumps(merged, indent=2) + "\n")
            api.upload_file(repo_id=repo_id, path_or_fileobj=str(cro_path),
                            path_in_repo="croissant.json", repo_type="dataset",
                            commit_message="Merge Hub-generated croissant fields")
    return f"https://huggingface.co/datasets/{repo_id}"


def sync_collection(api, dataset_ids: list[str]) -> str:
    slug = next((c.slug for c in api.list_collections(owner=HF_OWNER)
                 if c.title == COLLECTION_TITLE), None)
    if slug is None:
        slug = api.create_collection(
            COLLECTION_TITLE, namespace=HF_OWNER, private=False,
            description="Task data for the benchmark-* family of AI benchmarks "
                        "(aibenchmarkindex.com).").slug
    have = {item.item_id for item in api.get_collection(slug).items}
    for ds in dataset_ids:
        if ds not in have:
            api.add_collection_item(slug, ds, "dataset", exists_ok=True)
    return f"https://huggingface.co/collections/{slug}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="build and validate staging folders only, no upload")
    ap.add_argument("--only", metavar="ID",
                    help="process a single benchmark-<id>")
    args = ap.parse_args()
    packages = load_packages()
    if args.only:
        want = args.only if args.only.startswith("benchmark-") else f"benchmark-{args.only}"
        packages = [p for p in packages if p == want]
        if not packages:
            print(f"error: {args.only} not in {LIST_FILE}", file=sys.stderr)
            return 2
    with tempfile.TemporaryDirectory(prefix="hf-stage-") as work:
        for pkg in packages:
            try:
                rep = build_stage(pkg, Path(work))
            except Exception as exc:
                print(f"{pkg}: FAILED {exc}")
                return 1
            print(f"{rep['pkg']}: staged {rep['files']} files, "
                  f"{rep['tasks']} tasks, croissant: {rep['croissant']}")
    if args.dry_run:
        print("dry run: staging complete, no upload performed")
        return 0
    api = hf_api()
    for pkg in packages:
        print(upload_dataset(api, pkg, OUT_DIR / pkg))
    print(sync_collection(api, [f"{HF_OWNER}/{p}" for p in packages]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
