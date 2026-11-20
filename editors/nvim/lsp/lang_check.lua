--- Neovim 0.11+ native LSP config (vim.lsp.config / vim.lsp.enable).
--- Drop this file in lsp/ so `vim.lsp.enable('lang_check')` just works.
---
--- For older Neovim or nvim-lspconfig users, use require('lang_check').setup() instead.
return {
  cmd = { "language-check-server", "--lsp" },
  filetypes = {
    "markdown",
    "html",
    "latex",
    "typst",
    "restructuredtext",
    "org",
    "bibtex",
    "sweave",
  },
  root_markers = { ".languagecheck.yaml", ".git" },
  settings = {
    langCheck = {},
  },
  -- The server ignores code-running keys in a workspace config unless told
  -- the workspace is trusted; see lua/lang_check/trust.lua.
  before_init = function(params, config)
    params.initializationOptions = vim.tbl_extend(
      "force",
      params.initializationOptions or {},
      require("lang_check.trust").init_options(config.root_dir)
    )
  end,
}
