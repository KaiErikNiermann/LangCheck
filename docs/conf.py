# Configuration file for the Sphinx documentation builder.

project = "Language Check"
copyright = "2025, KaiErikNiermann"
author = "KaiErikNiermann"
release = "0.3.2"

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

# Context for templates
html_context = {
    "languages": languages,
    "current_language": language,
    "supported_languages": supported_languages,
}

# Source file suffixes
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
