# Language Check

A fast, multi-engine prose linter for VS Code and Neovim with a Rust core.

Language Check catches grammar, spelling, and style issues in Markdown, HTML, LaTeX, Typst, reStructuredText, Org mode, BibTeX, Forester, and R Sweave files using [Harper](https://github.com/elijah-potter/harper) and optional [LanguageTool](https://languagetool.org/) integration.

::::{grid} 2

:::{grid-item-card} VS Code
![LangCheck in VS Code](/_static/vscode_example.png)
:::

:::{grid-item-card} Neovim
![LangCheck in Neovim](/_static/neovim_example.png)
:::

::::

---

```{toctree}
:maxdepth: 2
:caption: User Guide

guide/motivation
guide/installation
guide/languagetool-setup
guide/configuration
guide/languages
guide/localization
```

```{toctree}
:maxdepth: 2
:caption: Advanced

advanced/providers
advanced/plugins
advanced/api
```

```{toctree}
:maxdepth: 2
:caption: Extending

guide-config-language
guide-plugin-language
tinylang-spec
```

```{toctree}
:maxdepth: 2
:caption: Reference

reference/cli
reference/config-schema
reference/publishing
reference/troubleshooting
```
