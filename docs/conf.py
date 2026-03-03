# Configuration file for the Sphinx documentation builder.

project = "Language Check"
copyright = "2025, KaiErikNiermann"
author = "KaiErikNiermann"
release = "0.2.1"

extensions = [
    "myst_parser",
    "sphinx_copybutton",
    "sphinx_design",
]

# MyST-Parser settings for Markdown support
myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "fieldlist",
    "tasklist",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", ".venv", "README.md"]

# Theme — furo with dark/light mode toggle
html_theme = "furo"
html_theme_options = {
    "navigation_with_keys": True,
}

html_static_path = ["_static"]
html_css_files = ["custom.css"]

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

# Context for templates
html_context = {
    "languages": languages,
    "current_language": language,
}

# Source file suffixes
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
