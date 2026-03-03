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
}
