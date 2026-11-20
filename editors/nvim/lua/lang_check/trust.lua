--- Whether the server may run the code a workspace's config names.
---
--- `engines.external` runs programs and `engines.wasm_plugins` loads modules.
--- A cloned repository's config is written by whoever wrote the repository,
--- so the server ignores those keys unless the client passes
--- `initializationOptions.trustWorkspace = true`. By default this asks through
--- Neovim's own trust store (`:help vim.secure.read()`), which remembers the
--- answer per file and asks again when the file changes.
local M = {}

--- The config file names the server reads, in the order it looks for them.
local FILES = { ".languagecheck.yaml", ".languagecheck.yml", ".languagecheck.json" }

--- Whether `text` mentions a key that runs or loads code. A plain substring
--- test: a false hit costs one prompt, a missed one would cost the gate.
--- @param text string
--- @return boolean
local function names_code(text)
  return text:find("external", 1, true) ~= nil or text:find("wasm_plugins", 1, true) ~= nil
end

--- @param root string|nil Workspace root the client starts the server for
--- @param mode boolean|"ask"|nil `true` or `false` decide outright; "ask" (the default) asks
--- @return boolean
function M.trusted(root, mode)
  if mode == true or mode == false then
    return mode
  end
  if not root then
    return false
  end
  for _, name in ipairs(FILES) do
    local path = root .. "/" .. name
    local file = io.open(path, "r")
    if file then
      local text = file:read("*a") or ""
      file:close()
      if not names_code(text) then
        return false
      end
      return vim.secure.read(path) ~= nil
    end
  end
  return false
end

--- `initializationOptions` for a server started at `root`.
--- @param root string|nil
--- @return table
function M.init_options(root)
  return { trustWorkspace = M.trusted(root, require("lang_check.config").get().trust_workspace) }
end

return M
