-- Neovim headless LSP smoke test for language-check-server.
--
-- Usage:
--   SERVER_BIN=/path/to/language-check-server \
--   FIXTURES=/path/to/fixtures \
--     nvim --headless -u NONE -l .github/nvim-lsp-test.lua
--
-- Exits 0 on success, 1 on failure.

local server_bin = os.getenv("SERVER_BIN")
local fixtures = os.getenv("FIXTURES")

if not server_bin or not fixtures then
  io.stderr:write("ERROR: SERVER_BIN and FIXTURES env vars required\n")
  os.exit(1)
end

-- Enable filetype detection (off with -u NONE) so nvim sends correct
-- language_id to the LSP server in textDocument/didOpen.
vim.cmd("filetype on")

local passed = 0
local failed = 0
local results = {}

local function pass(name)
  passed = passed + 1
  results[#results + 1] = string.format("  \27[32m✓\27[0m %s", name)
end

local function fail(name)
  failed = failed + 1
  results[#results + 1] = string.format("  \27[31m✗\27[0m %s", name)
end

--- Open a file, attach the LSP, wait for diagnostics, and return them.
--- @param filepath string Absolute path to the file
--- @param timeout_ms number Max time to wait for diagnostics
--- @return table[] diagnostics
local function get_diagnostics(filepath, timeout_ms)
  timeout_ms = timeout_ms or 10000

  -- Open the file in a buffer
  vim.cmd("edit " .. vim.fn.fnameescape(filepath))
  local bufnr = vim.api.nvim_get_current_buf()

  local received = false
  local diags = {}

  -- Start the LSP client
  local client_id = vim.lsp.start({
    name = "language-check-test",
    cmd = { server_bin, "--lsp" },
    root_dir = fixtures,
    handlers = {
      ["textDocument/publishDiagnostics"] = function(_, result, ctx)
        if ctx.bufnr == bufnr or result.uri == vim.uri_from_fname(filepath) then
          diags = result.diagnostics or {}
          received = true
        end
      end,
    },
  })

  if not client_id then
    fail("LSP client failed to start for " .. filepath)
    return {}
  end

  -- Wait for diagnostics
  local ok = vim.wait(timeout_ms, function()
    return received
  end, 100)
  if not ok then
    fail("timed out waiting for diagnostics: " .. filepath)
  end

  -- Stop the client
  vim.lsp.stop_client(client_id, true)
  -- Close buffer
  vim.api.nvim_buf_delete(bufnr, { force = true })

  return diags
end

--- Check if any diagnostic message matches a pattern.
local function has_diagnostic_matching(diags, pattern)
  for _, d in ipairs(diags) do
    if d.message and d.message:find(pattern) then
      return true
    end
  end
  return false
end

-- ══════════════════════════════════════════════════════════════════════
print("\n=== Neovim LSP: Markdown ===")

local md_diags = get_diagnostics(fixtures .. "/errors.md")

if #md_diags >= 2 then
  pass("Markdown: received " .. #md_diags .. " diagnostics (expected >= 2)")
else
  fail("Markdown: got " .. #md_diags .. " diagnostics, expected >= 2")
end

if has_diagnostic_matching(md_diags, "indefinite article") or has_diagnostic_matching(md_diags, "[Aa]rticle") then
  pass("Markdown: detected article error")
else
  fail("Markdown: did not detect article error")
end

if has_diagnostic_matching(md_diags, "repeat") or has_diagnostic_matching(md_diags, "[Rr]epetition") then
  pass("Markdown: detected word repetition")
else
  fail("Markdown: did not detect word repetition")
end

-- Check diagnostic structure
if md_diags[1] then
  local d = md_diags[1]
  if d.source == "language-check" then
    pass("Markdown: diagnostic source is 'language-check'")
  else
    fail("Markdown: unexpected source: " .. tostring(d.source))
  end

  if d.code and type(d.code) == "string" and #d.code > 0 then
    pass("Markdown: diagnostic has unified_id code: " .. d.code)
  else
    fail("Markdown: diagnostic missing unified_id code")
  end
end

-- ══════════════════════════════════════════════════════════════════════
print("\n=== Neovim LSP: LaTeX ===")

local tex_diags = get_diagnostics(fixtures .. "/errors.tex")

if #tex_diags >= 1 then
  pass("LaTeX: received " .. #tex_diags .. " diagnostics")
else
  fail("LaTeX: got 0 diagnostics, expected >= 1")
end

if has_diagnostic_matching(tex_diags, "indefinite article") or has_diagnostic_matching(tex_diags, "[Aa]rticle") then
  pass("LaTeX: detected article error")
else
  fail("LaTeX: did not detect article error")
end

-- ══════════════════════════════════════════════════════════════════════
print("\n=== Neovim LSP: HTML ===")

local html_diags = get_diagnostics(fixtures .. "/errors.html")

if #html_diags >= 1 then
  pass("HTML: received " .. #html_diags .. " diagnostics")
else
  fail("HTML: got 0 diagnostics, expected >= 1")
end

-- ══════════════════════════════════════════════════════════════════════
print("\n=== Neovim LSP: Clean file ===")

local clean_diags = get_diagnostics(fixtures .. "/clean.md")

if #clean_diags == 0 then
  pass("Clean: no diagnostics for error-free file")
else
  fail("Clean: got " .. #clean_diags .. " unexpected diagnostics")
end

-- ══════════════════════════════════════════════════════════════════════
print("\n=== Neovim LSP Results ===")
for _, line in ipairs(results) do
  print(line)
end

local total = passed + failed
print(string.format("\n%d/%d tests passed", passed, total))

if failed > 0 then
  print(string.format("\27[31m%d test(s) FAILED\27[0m", failed))
  os.exit(1)
end

print("\27[32mAll Neovim LSP smoke tests passed.\27[0m")
os.exit(0)
