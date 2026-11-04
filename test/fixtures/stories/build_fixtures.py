"""Regenerate the story converter's golden fixtures from the reference Python pipeline.

    python3 test/fixtures/stories/build_fixtures.py [OUT_DIR]

Run from anywhere; OUT_DIR defaults to this directory (overwriting the
goldens), so pass a scratch dir to compare first. Reads ff-site's
archive-to-markdown (FF_SITE_DIR, default: the ff-site checkout next to
ff-server):

- docx/<slug>.docx are the Google Docs exports already here (from the FF
  shared Drive). Each is converted by story-docx-to-md.py with placeholder
  speakers (C<hex>) into docx/<slug>.md + .meta.json, so the golden tests
  conversion, not attribution.
- manuscripts/<slug>.md|.json: every md/stories manuscript and its
  story-md-to-api.py payload.

Saved from the story-docx-import session's work/ folder (2026-11-03).
"""
import importlib.util
import json
import os
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
SITE = pathlib.Path(os.environ.get("FF_SITE_DIR", HERE.parents[3] / "ff-site")).resolve()
A2M = SITE / "archive-to-markdown"
OUT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, A2M / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def frontmatter(path):
    lines = path.read_text(encoding="utf-8").split("\n")
    meta = {}
    for line in lines[1 : lines.index("---", 1)]:
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta


d2m = load("d2m", "story-docx-to-md.py")
m2a = load("m2a", "story-md-to-api.py")
for sub in ("docx", "manuscripts"):
    (OUT / sub).mkdir(parents=True, exist_ok=True)

n = 0
for docx in sorted((HERE / "docx").glob("*.docx")):
    slug = docx.stem
    n += 1
    if OUT != HERE:
        shutil.copyfile(docx, OUT / "docx" / docx.name)
    fm = frontmatter(A2M / "md" / "stories" / f"{slug}.md")
    paragraphs = d2m.read_paragraphs(d2m.load_document(str(docx)).find(d2m.W + "body"))
    meta = {
        "slug": slug,
        "title": fm.get("title"),
        "format": fm.get("format", "script"),
        "season": fm.get("season"),
        "authors": fm.get("authors"),
        "colors": {c: f"C{c.lstrip('#')}" for c in d2m.collect_colors(paragraphs)},
    }
    body, warnings = d2m.convert(paragraphs, meta)
    with open(OUT / "docx" / f"{slug}.meta.json", "w") as f:
        json.dump({"meta": meta, "warnings": warnings}, f, indent=1, ensure_ascii=False)
    (OUT / "docx" / f"{slug}.md").write_text("\n".join(d2m.frontmatter(meta) + body).rstrip() + "\n", encoding="utf-8")

m = 0
for md in sorted((A2M / "md" / "stories").glob("*.md")):
    m += 1
    shutil.copyfile(md, OUT / "manuscripts" / md.name)
    with open(OUT / "manuscripts" / f"{md.stem}.json", "w") as f:
        json.dump(m2a.convert(md), f, indent=1, ensure_ascii=False)
print(f"docx fixtures: {n}, manuscript fixtures: {m} -> {OUT}")
