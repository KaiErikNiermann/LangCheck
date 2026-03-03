--- Startup guard and user command registration.
if vim.g.loaded_lang_check then
  return
end
vim.g.loaded_lang_check = true

vim.api.nvim_create_user_command("LangCheck", function(cmd)
  local sub = cmd.fargs[1]
  if sub == "install" then
    require("lang_check.binary").install()
  elseif sub == "info" then
    vim.print(require("lang_check").info())
  elseif sub == "start" then
    require("lang_check").start()
  else
    vim.notify("[lang-check] Usage: :LangCheck {install|info|start}", vim.log.levels.INFO)
  end
end, {
  nargs = 1,
  complete = function()
    return { "install", "info", "start" }
  end,
  desc = "Language Check commands",
})
