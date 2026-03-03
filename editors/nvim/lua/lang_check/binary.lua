--- Binary discovery for language-check-server.
local M = {}

local config = require("lang_check.config")

--- Resolve the server binary path.
--- Order: (1) user override, (2) $PATH lookup, (3) stdpath data install.
--- @return string? path Absolute path to the binary, or nil if not found
function M.resolve()
  local cfg = config.get()
  local cmd = cfg.server.cmd[1]

  -- 1. Explicit user override (absolute path)
  if cmd ~= "language-check-server" then
    if vim.fn.executable(cmd) == 1 then
      return cmd
    end
    return nil
  end

  -- 2. On $PATH (includes Mason's bin/)
  if vim.fn.executable("language-check-server") == 1 then
    return "language-check-server"
  end

  -- 3. Plugin-managed install location
  local managed = M.install_path()
  if vim.uv.fs_stat(managed) then
    return managed
  end

  return nil
end

--- @return string path Where a plugin-managed binary would live
function M.install_path()
  local base = vim.fn.stdpath("data") .. "/lang-check/bin"
  local ext = vim.fn.has("win32") == 1 and ".exe" or ""
  return base .. "/language-check-server" .. ext
end

--- Detect the GitHub release asset name for the current platform.
--- @return string? asset_suffix e.g. "x86_64-unknown-linux-gnu"
function M.platform_target()
  local uname = vim.uv.os_uname()
  local arch = uname.machine
  local sys = uname.sysname:lower()

  local target_arch = ({ x86_64 = "x86_64", aarch64 = "aarch64", arm64 = "aarch64" })[arch]
  if not target_arch then
    return nil
  end

  local target_os = ({
    linux = "unknown-linux-gnu",
    darwin = "apple-darwin",
    windows_nt = "pc-windows-msvc",
  })[sys]
  if not target_os then
    return nil
  end

  return target_arch .. "-" .. target_os
end

return M
