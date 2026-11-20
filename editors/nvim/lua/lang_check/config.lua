--- Default configuration and user config merging.
local M = {}

--- @class LangCheckServerConfig
--- @field cmd? string[] Command to start the LSP server
--- @field filetypes? string[] Filetypes to attach to

--- @class LangCheckSettings LSP settings sent via workspace/didChangeConfiguration
--- @field langCheck? table Engine/performance overrides

--- @class LangCheckConfig
--- @field server? LangCheckServerConfig
--- @field autostart? boolean Start LSP automatically on matching filetypes
--- @field settings? LangCheckSettings LSP settings forwarded to the server
--- @field trust_workspace? boolean|"ask" Let a workspace config run code (engines.external, engines.wasm_plugins)

--- @type LangCheckConfig
M.defaults = {
  trust_workspace = "ask",
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
  settings = {
    langCheck = {},
  },
}

--- Merge user config (vim.g.lang_check) with defaults.
--- @return LangCheckConfig
function M.get()
  return vim.tbl_deep_extend("force", M.defaults, vim.g.lang_check or {})
end

return M
