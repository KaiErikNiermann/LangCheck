--- :checkhealth lang_check
local M = {}

local binary = require("lang_check.binary")

function M.check()
  vim.health.start("lang-check.nvim")

  -- Neovim version
  if vim.fn.has("nvim-0.10") == 1 then
    vim.health.ok("Neovim >= 0.10")
  elseif vim.fn.has("nvim-0.9") == 1 then
    vim.health.warn("Neovim 0.9 detected; 0.10+ recommended for full feature support")
  else
    vim.health.error("Neovim 0.9+ required")
  end

  -- Binary
  local bin = binary.resolve()
  if bin then
    vim.health.ok("language-check-server found: " .. bin)
    local out = vim.fn.system({ bin, "--version" })
    if vim.v.shell_error == 0 then
      vim.health.ok("Version: " .. vim.trim(out))
    end
  else
    vim.health.warn(
      "language-check-server not found on $PATH",
      { "Install via Mason, cargo install lang-check, or :LangCheck install" }
    )
  end

  -- Config file
  local root = vim.fn.getcwd()
  local cfg_path = root .. "/.languagecheck.yaml"
  local cfg_lines = nil
  if vim.uv.fs_stat(cfg_path) then
    vim.health.ok(".languagecheck.yaml found in workspace")
    cfg_lines = vim.fn.readfile(cfg_path)
  else
    vim.health.info("No .languagecheck.yaml found (optional — defaults are fine)")
  end

  -- LanguageTool reachability (if configured)
  if cfg_lines then
    local lt_url = nil
    for _, line in ipairs(cfg_lines) do
      local url = line:match("languagetool_url:%s*[\"']?([^\"'%s]+)")
      if url then
        lt_url = url
        break
      end
    end
    if lt_url then
      vim.fn.system({ "curl", "-sf", "--max-time", "3", lt_url .. "/v2/languages" })
      if vim.v.shell_error == 0 then
        vim.health.ok("LanguageTool reachable at " .. lt_url)
      else
        vim.health.warn("LanguageTool not reachable at " .. lt_url, {
          "Ensure LanguageTool server is running or check the URL in .languagecheck.yaml",
        })
      end
    end
  end
end

return M
