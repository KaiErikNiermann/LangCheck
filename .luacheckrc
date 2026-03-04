-- luacheck configuration for lang-check Neovim plugin
std = "luajit+busted"

-- Neovim globals — vim.g / vim.b / vim.w are writable by design
globals = { "vim" }

-- Exclude vendored / generated files
exclude_files = {
  "rust-core/**",
  "extension/**",
  "node_modules/**",
}

-- Per-file overrides
files[".github/nvim-lsp-test.lua"] = {
  -- Standalone test script, not a module
  allow_defined_top = true,
}
