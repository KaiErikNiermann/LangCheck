# Neovim Setup

Language Check provides a native Neovim plugin that connects to the
`language-check-server` binary via LSP. It supports Neovim 0.10+ and
works with lazy.nvim, packer.nvim, vim-plug, or the built-in Neovim
0.11+ LSP config.

## Installing the Binary

The plugin needs the `language-check-server` binary. Pick one method:

::::{tab-set}

:::{tab-item} :LangCheck install (recommended)
After installing the plugin, run inside Neovim:

```vim
:LangCheck install
```

This downloads the correct binary for your platform from GitHub Releases
into `~/.local/share/nvim/lang-check/bin/`.
:::

:::{tab-item} cargo
```bash
cargo install lang-check
```
:::

:::{tab-item} Manual download
Download from [GitHub Releases](https://github.com/KaiErikNiermann/LangCheck/releases),
extract, and place `language-check-server` somewhere on your `$PATH`.
:::

::::

## Plugin Installation

::::{tab-set}

:::{tab-item} lazy.nvim
```lua
{
  "KaiErikNiermann/lang-check.nvim",
  ft = { "markdown", "html", "latex", "typst", "restructuredtext",
         "org", "bibtex", "sweave" },
  opts = {},
}
```

The `ft` key ensures the plugin loads only when you open a supported
file type. `opts = {}` calls `setup()` with defaults.
:::

:::{tab-item} packer.nvim
```lua
use {
  "KaiErikNiermann/lang-check.nvim",
  config = function()
    require("lang_check").setup()
  end,
}
```
:::

:::{tab-item} Neovim 0.11+ (no plugin manager)
No plugin manager needed. The plugin ships an `lsp/lang_check.lua`
file that works with the native LSP config:

```lua
-- init.lua
vim.lsp.enable("lang_check")
```

Make sure the plugin directory is on your runtime path, or clone it
directly:

```bash
git clone https://github.com/KaiErikNiermann/lang-check.nvim \
  ~/.local/share/nvim/site/pack/plugins/start/lang-check.nvim
```
:::

::::

## Configuration

Pass options to `setup()` to override defaults. Here is a full example
with all available keys and their defaults:

```lua
require("lang_check").setup({
  -- Server settings
  server = {
    cmd = { "language-check-server", "--lsp" },
    filetypes = {
      "markdown", "html", "latex", "typst",
      "restructuredtext", "org", "bibtex", "sweave",
    },
  },

  -- Start the LSP client automatically on matching filetypes
  autostart = true,

  -- LSP workspace settings (sent via workspace/didChangeConfiguration)
  settings = {
    langCheck = {
      engines = {
        harper = true,
        languagetool = false,
        languagetool_url = "http://localhost:8010",
        english_engine = "harper",  -- "harper" or "languagetool"
        spell_language = "en-US",   -- BCP-47 tag for checking language
      },
      performance = {
        high_performance_mode = false,
        debounce_ms = 300,
        max_file_size = 0,  -- 0 = unlimited
      },
    },
  },
})
```

### Common Configurations

**LanguageTool enabled with German checking:**

```lua
require("lang_check").setup({
  settings = {
    langCheck = {
      engines = {
        harper = true,
        languagetool = true,
        spell_language = "de-DE",
      },
    },
  },
})
```

**LanguageTool as the English engine (deeper analysis):**

```lua
require("lang_check").setup({
  settings = {
    langCheck = {
      engines = {
        languagetool = true,
        english_engine = "languagetool",
      },
    },
  },
})
```

**High performance mode (Harper only, no network):**

```lua
require("lang_check").setup({
  settings = {
    langCheck = {
      performance = {
        high_performance_mode = true,
      },
    },
  },
})
```

**Custom binary path:**

```lua
require("lang_check").setup({
  server = {
    cmd = { "/path/to/language-check-server", "--lsp" },
  },
})
```

## Workspace Configuration

In addition to LSP settings above, Language Check reads a
`.languagecheck.yaml` file from your project root for per-project
configuration (rule overrides, exclude patterns, auto-fix rules, etc.).
See [Configuration](configuration.md) for the full schema.

The LSP settings passed via `setup()` and the YAML config are
complementary — the YAML file is the primary source of truth for engine
toggles and rules, while LSP settings provide an initial configuration
before the server reads the YAML file.

## Commands

| Command              | Description                          |
|----------------------|--------------------------------------|
| `:LangCheck install` | Download the server binary for your platform |
| `:LangCheck info`    | Print binary path, config, and platform info |
| `:LangCheck start`   | Manually start the LSP client        |

## Health Check

Run the built-in health check to verify your setup:

```vim
:checkhealth lang_check
```

This checks:
- Neovim version (0.10+ required)
- Binary availability and version
- `.languagecheck.yaml` detection
- LanguageTool connectivity (if configured)

## Diagnostics

Diagnostics appear inline via Neovim's built-in LSP diagnostic system.
Use standard keybindings to navigate:

```lua
-- Go to next/previous diagnostic
vim.keymap.set("n", "]d", vim.diagnostic.goto_next)
vim.keymap.set("n", "[d", vim.diagnostic.goto_prev)

-- Show diagnostic in floating window
vim.keymap.set("n", "<leader>e", vim.diagnostic.open_float)

-- List all diagnostics in location list
vim.keymap.set("n", "<leader>q", vim.diagnostic.setloclist)
```

Code actions (quickfixes) are available via `vim.lsp.buf.code_action()`
on a diagnostic.
