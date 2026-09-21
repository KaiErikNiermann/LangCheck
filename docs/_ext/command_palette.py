"""Emit the action index the docs command palette (Ctrl+K) searches.

Sphinx already knows every page, its title and its headings; the palette needs
the same thing as JSON next to the script that reads it. This extension writes
``_static/command-palette-index.json`` at the end of an HTML build, so the
index can never drift from the pages that were built.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from docutils import nodes
from sphinx import addnodes

if TYPE_CHECKING:
    from sphinx.application import Sphinx
    from sphinx.environment import BuildEnvironment

INDEX_FILENAME = "command-palette-index.json"


class Heading(TypedDict):
    """One in-page section, linked by its anchor."""

    title: str
    url: str


class Page(TypedDict):
    """One built document, grouped under its toctree caption."""

    title: str
    url: str
    section: str
    headings: list[Heading]


class Link(TypedDict):
    """One off-site project link, taken from ``html_context``."""

    title: str
    url: str


class PaletteIndex(TypedDict):
    """The whole payload written to ``_static``."""

    pages: list[Page]
    links: list[Link]
    searchUrl: str


# Section headers for pages no captioned toctree claims: the landing page, and
# anything else reachable only by a direct link.
HOME_CAPTION = "Home"
FALLBACK_CAPTION = "Pages"

# (html_context key, label) for the project links appended to the palette.
PROJECT_LINKS: tuple[tuple[str, str], ...] = (
    ("repo_url", "GitHub repository"),
    ("release_url", "Release notes"),
    ("marketplace_url", "VS Code Marketplace"),
    ("openvsx_url", "Open VSX registry"),
    ("crates_url", "crates.io package"),
)


def _captions(env: BuildEnvironment) -> dict[str, str]:
    """Map each docname to the caption of the toctree that lists it."""
    captions: dict[str, str] = {}
    for toc in env.tocs.values():
        for toctree in toc.findall(addnodes.toctree):
            caption = toctree.get("caption")
            if not caption:
                continue
            for _title, docname in toctree.get("entries", ()):
                if docname:
                    captions[docname] = caption
    return captions


def _headings(env: BuildEnvironment, docname: str, page_url: str) -> list[Heading]:
    """Pull the in-page section anchors out of the document's local toc."""
    toc = env.tocs.get(docname)
    if toc is None:
        return []
    return [
        Heading(title=ref.astext(), url=f"{page_url}{anchor}")
        for ref in toc.findall(nodes.reference)
        if (anchor := ref.get("anchorname", ""))
    ]


def _pages(app: Sphinx) -> list[Page]:
    env = app.env
    captions = _captions(env)
    pages: list[Page] = []
    for docname in sorted(env.all_docs):
        title_node = env.titles.get(docname)
        if title_node is None:
            continue
        url = app.builder.get_target_uri(docname)
        default = HOME_CAPTION if docname == env.config.root_doc else FALLBACK_CAPTION
        pages.append(
            Page(
                title=title_node.astext(),
                url=url,
                section=captions.get(docname, default),
                headings=_headings(env, docname, url),
            )
        )
    return pages


def _links(app: Sphinx) -> list[Link]:
    context: dict[str, Any] = app.config.html_context
    return [
        Link(title=label, url=url)
        for key, label in PROJECT_LINKS
        if isinstance(url := context.get(key), str) and url
    ]


def write_index(app: Sphinx, exception: Exception | None) -> None:
    """Write the palette index once the HTML build has produced its pages."""
    if exception is not None or app.builder.format != "html":
        return

    index = PaletteIndex(
        pages=_pages(app),
        links=_links(app),
        searchUrl=app.builder.get_target_uri("search"),
    )
    static_dir = Path(app.outdir) / "_static"
    static_dir.mkdir(parents=True, exist_ok=True)
    (static_dir / INDEX_FILENAME).write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
    )


def setup(app: Sphinx) -> dict[str, Any]:
    app.connect("build-finished", write_index)
    return {"version": "1.0", "parallel_read_safe": True, "parallel_write_safe": True}
