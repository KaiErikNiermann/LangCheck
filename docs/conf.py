# Configuration file for the Sphinx documentation builder.

import sys
from pathlib import Path

# Local extensions (docs/_ext) — the command palette index generator lives here.
sys.path.insert(0, str(Path(__file__).parent / "_ext"))

project = "Language Check"
copyright = "2025, KaiErikNiermann"
author = "KaiErikNiermann"
release = "0.6.1"

extensions = [
    "myst_parser",
    "sphinx_copybutton",
    "sphinx_design",
    "command_palette",
]

# MyST-Parser settings for Markdown support
myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "fieldlist",
    "tasklist",
]
# Generate anchors for h1-h3 so the in-page `](#section)` links used throughout
# the reference tables resolve. Without this MyST emits no heading ids and every
# such link is a build warning that renders as a dead link.
myst_heading_anchors = 3

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", ".venv", "README.md"]

# Theme — furo with dark/light mode toggle
html_theme = "furo"
html_theme_options = {
    "navigation_with_keys": True,
}

html_static_path = ["_static"]
html_css_files = ["custom.css"]

# The palette is an ES module: it imports the vendored ninja-keys bundle and
# reads the action index that the command_palette extension writes.
html_js_files = [("command-palette.js", {"type": "module"})]

# Sidebar: insert language picker after brand, before search
html_sidebars = {
    "**": [
        "sidebar/brand.html",
        "selectlang.html",
        "sidebar/search.html",
        "sidebar/scroll-start.html",
        "sidebar/navigation.html",
        "sidebar/ethical-ads.html",
        "sidebar/scroll-end.html",
        "sidebar/variant-selector.html",
    ],
}

# Internationalization
language = "en"
locale_dirs = ["locale/"]
gettext_compact = False

languages = [
    ("en", "English"),
    ("fr", "Français"),
    ("es", "Español"),
    ("ja", "日本語"),
]

# Languages with enough translations to deploy (add codes as translations land)
supported_languages = {"en"}

# Project links shown in the sidebar brand row (see _templates/sidebar/brand.html)
marketplace_url = (
    "https://marketplace.visualstudio.com/items?itemName=KaiErikNiermann.language-check"
)
openvsx_url = "https://open-vsx.org/extension/KaiErikNiermann/language-check"
crates_url = "https://crates.io/crates/lang-check"
repo_url = "https://github.com/KaiErikNiermann/LangCheck"
release_url = f"{repo_url}/releases/tag/v{release}"

# Context for templates
html_context = {
    "release_url": release_url,
    "marketplace_url": marketplace_url,
    "crates_url": crates_url,
    "repo_url": repo_url,
    "openvsx_url": openvsx_url,
    "languages": languages,
    "current_language": language,
    "supported_languages": supported_languages,
}

# Source file suffixes
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
