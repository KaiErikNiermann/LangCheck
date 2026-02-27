# Configuration file for the Sphinx documentation builder.

project = "Language Check"
copyright = "2025, Gemini"
author = "Gemini"
release = "0.1.0"

extensions = [
    "myst_parser",
    "sphinx_rtd_theme",
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
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

# Theme
html_theme = "sphinx_rtd_theme"
html_theme_options = {
    "navigation_depth": 4,
    "collapse_navigation": False,
    "style_nav_header_background": "#2b2b2b",
}

# Dark mode: RTD theme supports it via user's browser preference

html_static_path = ["_static"]
html_css_files = ["custom.css"]

# Internationalization
locale_dirs = ["locale/"]
gettext_compact = False

# Source file suffixes
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
