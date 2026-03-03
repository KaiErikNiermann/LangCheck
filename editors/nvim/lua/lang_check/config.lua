--- Default configuration and user config merging.
local M = {}

--- @class LangCheckServerConfig
--- @field cmd? string[] Command to start the LSP server
--- @field filetypes? string[] Filetypes to attach to

--- @class LangCheckConfig
--- @field server? LangCheckServerConfig
--- @field autostart? boolean Start LSP automatically on matching filetypes

--- @type LangCheckConfig
M.defaults = {
  server = {
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
  },
  autostart = true,
}

--- Merge user config (vim.g.lang_check) with defaults.
--- @return LangCheckConfig
function M.get()
  return vim.tbl_deep_extend("force", M.defaults, vim.g.lang_check or {})
end

return M
