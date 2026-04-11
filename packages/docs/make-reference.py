"""Copy generated API docs and build sidebar for Starlight."""

import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent
GENERATED_DIR = DOCS_DIR / "../cmaf-lite/__generated_docs__"
MD_SOURCE_DIR = GENERATED_DIR / "markdown"
API_JSON_PATH = GENERATED_DIR / "cmaf-lite.api.json"
REF_DIR = DOCS_DIR / "src/content/docs/reference"

# Copy markdown files
if REF_DIR.exists():
    shutil.rmtree(REF_DIR)
shutil.copytree(MD_SOURCE_DIR, REF_DIR)

# Build sidebar from api.json
api_model = json.loads(API_JSON_PATH.read_text())
pkg = api_model["members"][0]
pkg_name = api_model["name"]

kind_groups = defaultdict(list)
for member in pkg.get("members", []):
    name = member.get("name", "")
    link = f"/reference/{pkg_name}.{name}/".lower()
    md_name = f"{pkg_name}.{name}".lower() + ".md"
    if md_name.endswith("event.md"):
        kind_groups["Event"].append({"label": name, "link": link})
    else:
        kind_groups[member["kind"]].append({"label": name, "link": link})

sidebar = sorted(
    [
        {"label": kind, "items": sorted(items, key=lambda x: x["label"])}
        for kind, items in kind_groups.items()
    ],
    key=lambda x: x["label"],
)
for group in sidebar[1:]:
    group["collapsed"] = True

# Add frontmatter and rewrite links
KIND_RE = re.compile(r" (class|enum|interface|variable|type alias|type|package)$", re.I)
LINK_RE = re.compile(r"\./(\w[\w.-]+)\.md")

for md in REF_DIR.glob("*.md"):
    content = md.read_text()
    title_match = re.search(r"^## (.+)$", content, re.M)
    title = KIND_RE.sub("", title_match.group(1)) if title_match else md.name
    slug = f"reference/{md.stem}"
    rewritten = LINK_RE.sub(r"/reference/\1", content)
    md.write_text(f"---\ntitle: {title}\nslug: {slug}\n---\n\n{rewritten}")

# Write sidebar
sidebar_path = DOCS_DIR / "sidebar-reference.json"
sidebar_json = [{"label": "Reference", "collapsed": True, "items": sidebar}]
sidebar_path.write_text(json.dumps(sidebar_json, indent=2))
