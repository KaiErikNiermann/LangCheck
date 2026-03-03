--- lang-check.nvim — grammar and style checking for Neovim.
local M = {}

local config = require("lang_check.config")
local binary = require("lang_check.binary")

--- Optional setup call. Merges user opts into vim.g.lang_check and starts
--- the LSP client if autostart is enabled.
--- @param opts? LangCheckConfig
function M.setup(opts)
  if opts then
    vim.g.lang_check = vim.tbl_deep_extend("force", vim.g.lang_check or {}, opts)
  end

  local cfg = config.get()
  if cfg.autostart then
    M.start()
  end
end

--- Start the LSP client for matching filetypes.
function M.start()
  local cfg = config.get()
  local bin = binary.resolve()
  if not bin then
    vim.notify(
      "[lang-check] language-check-server not found. Run :LangCheck install or add it to $PATH.",
      vim.log.levels.WARN
    )
    return
  end

  local cmd = vim.deepcopy(cfg.server.cmd)
  cmd[1] = bin

  vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("LangCheckLsp", { clear = true }),
    pattern = cfg.server.filetypes,
    callback = function(ev)
      vim.lsp.start({
        name = "lang-check",
        cmd = cmd,
        root_dir = vim.fs.root(ev.buf, { ".languagecheck.yaml", ".git" }),
        settings = cfg.settings or {},
      }, { bufnr = ev.buf })
    end,
  })
end

--- Get info about the current lang-check setup.
--- @return table
function M.info()
  local bin = binary.resolve()
  return {
    binary = bin,
    config = config.get(),
    platform = binary.platform_target(),
    install_path = binary.install_path(),
  }
end

return M
