# Privacy and trust

:::{admonition} Beta
:class: note
The browser extension is in early development. Its trust boundaries are described here as they are in the code today and may be tightened. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

## Where your text goes

The text of the open document goes from the page to the extension, then to the native host, then to `language-check-server`, all on your machine. Nothing in that path is a LangCheck service. The extension asks the browser for the `nativeMessaging` and `storage` permissions, and its scripts run only on the pages of the four supported sites.

Which engines read the text is up to the workspace config. Harper is the default and runs inside the core. An engine you turn on that talks to a server, such as LanguageTool, sends the text it checks to the URL you configured, as it does in VS Code.

## What stays on disk

The host keeps a directory per workspace under your user data directory, `language-check/web/<key>/`. It holds the workspace's config, the words you added with "Add to dictionary" and a copy of the site's dictionary.

## What the extension does on the site's behalf

On Overleaf and Typst the extension reads the dictionary the site keeps for you, using the page's own signed-in session. For Typst this is the same request the Typst app makes for your settings, and for Overleaf it is the list embedded in the project page. It writes to the site's dictionary only when you choose `dictionaries.add_to: site` and add a word, and it does so the way the site's own "Add to dictionary" does.

The extension also reads the project's file list from the site, so that `include` and `exclude` can match documents by their path.

## What a page can do

A web page shares its JavaScript realm with the site's own scripts and with other extensions' scripts, so the extension treats everything the page side sends as untrusted. In practice a script on the page can ask for checks of text it already has. It can also ask for words to be learned in its own workspace and for findings to be ignored. It cannot name a file, choose a workspace or read or write the config. The extension takes the workspace from the tab's address as the browser reports it, never from a message.

The limits that hold the page to this:

- Each request is parsed strictly. Oversized text, malformed words and unknown fields are refused or dropped.
- A page may have at most 8 requests in flight. It can have one panel of each kind open, and it can make the extension open at most ten tabs a minute.
- Reading, writing and probing the config is open only to the extension's own config tab. Exclude Current File is the one config change a page can ask for, and the extension passes it on once for each time you choose the command in the palette.
- Every edit names the text it replaces and is refused when the editor no longer holds that text.
- Errors reach the page as one fixed sentence per kind of error. The detail, which can name local paths, stays in the extension's console. The one exception is a sentence the core wrote for the person at the editor, such as why "Add to dictionary" was refused.

## What the native host does

The host sits between the browser and the core. It removes anything that names a file from each request and confines every workspace to its own directory under the data directory. It caps the size of a check and scrubs local paths from what it answers. It refuses a config that would run a program or name a file outside its workspace, as described in [settings](settings.md#what-a-workspace-config-may-not-do). A page that gets control of the extension can make the core check text and learn words, and cannot make it read or write anywhere else.

The Firefox host manifest admits one extension id, `language-check@kaierikniermann.github.io`. The Chrome manifest admits the one id you give it at install time.
