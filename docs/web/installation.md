# Installing the browser extension

:::{admonition} Beta
:class: note
The browser extension has no store listing and no release download yet. The steps below build it from the repository and load it as a development extension. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

Three pieces have to be in place.

- The extension, built from the `web/` directory of the repository.
- The native messaging host, `language-check-native-host`, registered with your browser.
- The core, `language-check-server`, which the host starts. It has to sit in the same directory as the host.

Both programs are built from `rust-core/`, so one `cargo build --release` produces them. The prerequisites are those of [CONTRIBUTING.md](https://github.com/KaiErikNiermann/LangCheck/blob/main/CONTRIBUTING.md): a Rust toolchain, pnpm and the Protobuf compiler.

## With the Justfile

From the repository root:

```sh
just install-local-web
```

This builds the release core, builds the extension into `web/dist`, registers the host with Firefox, and runs `language-check-native-host doctor`. If `CHROME_EXTENSION_ID` is set it also registers the host for Chrome. It cannot load the extension for you, because a browser has no command-line way to install a temporary add-on.

## By hand

Build the core and register the host:

```sh
cd rust-core && cargo build --release
./target/release/language-check-native-host install --browser firefox
```

For Chrome or Chromium, the host manifest names the one extension id it admits, so load the extension first and read its id from `chrome://extensions`:

```sh
./target/release/language-check-native-host install --browser chrome --chrome-extension-id <id from chrome://extensions>
```

`--browser` takes `firefox`, `chrome` or `chromium`. A Chrome extension id is 32 letters from `a` to `p`. The host manifest is written to the browser's user-level `NativeMessagingHosts` directory, for example `~/.mozilla/native-messaging-hosts/language_check.json` for Firefox on Linux. Chrome and Chromium keep it under `~/.config/google-chrome/` and `~/.config/chromium/` on Linux. `--dir` writes it somewhere else, such as a test profile.

Build the extension:

```sh
cd web && pnpm install && pnpm run build
```

## Loading the extension

- In Firefox, open `about:debugging`, choose This Firefox, then Load Temporary Add-on, and pick `web/dist/manifest.json`.
- In Chrome, open `chrome://extensions`, turn on developer mode, choose Load unpacked, and pick `web/dist`. Then register the host with the extension id shown there.

After a rebuild, reload the extension from the same page and reload the site tab.

## Check the setup

```sh
./target/release/language-check-native-host doctor
```

`doctor` prints where the host and the server are, whether the server is executable, and for Firefox, Chrome and Chromium whether a manifest exists and leads to a host that can start. It exits with an error when it finds a problem, and it prints the `install` command that fixes a broken registration. A browser with no manifest is reported as "not registered". It is a problem only when no browser at all is registered.

`install` warns when the host you register is a debug build, because `cargo clean` deletes it and the browser then cannot start the host. Register a release build.

## Where the extension keeps its files

The host keeps one directory per workspace under the user data directory, in `language-check/web/<key>/` (`~/.local/share/language-check/web/` on Linux). The key is the site and the project or account, so each Overleaf project, Typst project, Notion workspace and Gmail account has its own. A workspace's config, its learned words and its copy of the site's dictionary live there. See [settings](settings.md).
