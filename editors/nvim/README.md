# lang-check.nvim

Grammar, style, and spelling diagnostics for Neovim via the
[Language Check](https://github.com/KaiErikNiermann/LangCheck) prose linter.

Supports **Markdown**, **HTML**, **LaTeX**, **Typst**, **reStructuredText**,
**Org**, **BibTeX**, and **Sweave**.

![LangCheck in Neovim](https://raw.githubusercontent.com/KaiErikNiermann/LangCheck/main/assets/neovim_example.png)

## Installation

### lazy.nvim

```lua
{
  "KaiErikNiermann/lang-check.nvim",
  ft = { "markdown", "html", "latex", "typst", "restructuredtext",
         "org", "bibtex", "sweave" },
  opts = {},
}
```

### packer.nvim

```lua
use {
  "KaiErikNiermann/lang-check.nvim",
  config = function()
    require("lang_check").setup()
  end,
}
```

### Neovim 0.11+ (native LSP config)

No plugin manager needed — the `lsp/lang_check.lua` file works with
`vim.lsp.enable`:

```lua
vim.lsp.enable("lang_check")
```

## Binary

The plugin needs the `language-check-server` binary. Install it via:

- `:LangCheck install` — downloads the correct binary from GitHub Releases
- [Mason.nvim](https://github.com/mason-org/mason.nvim) — when available in the registry
- `cargo install lang-check`
- Manual download from [Releases](https://github.com/KaiErikNiermann/LangCheck/releases)

## Configuration

```lua
require("lang_check").setup({
  server = {
    cmd = { "language-check-server", "--lsp" },
    filetypes = { "markdown", "html", "latex", "typst",
                  "restructuredtext", "org", "bibtex", "sweave" },
  },
  autostart = true,
  settings = {
    langCheck = {
      engines = {
        harper = true,
        languagetool = false,
        vale = false,
      },
    },
  },
})
```

See `:help lang-check` for the full configuration reference.

## Commands

| Command              | Description                          |
|----------------------|--------------------------------------|
| `:LangCheck install` | Download and install the server binary |
| `:LangCheck info`    | Print current config and binary path |
| `:LangCheck start`   | Manually start the LSP client        |

## Health Check

Run `:checkhealth lang_check` to verify Neovim version, binary availability,
workspace config, and LanguageTool connectivity.

## License

MIT
