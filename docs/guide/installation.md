# Installation

## VS Code Extension

Install from the VS Code marketplace:

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS)
3. Search for **Language Check**
4. Click **Install**

On first activation, the extension will prompt you to download the core binary for your platform. You can also install it manually.

## VSCodium and other non-Microsoft builds

VSCodium, Code — OSS, Cursor, Windsurf and similar builds cannot reach the Microsoft
marketplace. The same extension is published to [Open VSX](https://open-vsx.org/extension/KaiErikNiermann/language-check),
which those editors query by default:

1. Open VSCodium
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS)
3. Search for **Language Check**
4. Click **Install**

Or from the command line:

```bash
codium --install-extension KaiErikNiermann.language-check
```

The published VSIX is platform-independent — the core binary is fetched separately on
first activation, so there is a single artifact for every editor and platform.

If your editor is not wired to Open VSX, grab the `.vsix` from
[GitHub Releases](https://github.com/KaiErikNiermann/LangCheck/releases) and install it
directly:

```bash
codium --install-extension language-check-<version>.vsix
```

### Offline or proxied installs

The extension downloads `language-check-server` from GitHub Releases the first time it
activates. On a machine without direct GitHub access, install the binary yourself
(see [CLI Binary](#cli-binary) below) and point the extension at it:

```json
{
  "languageCheck.core.binaryPath": "/usr/local/bin/language-check-server"
}
```

With that set the extension never attempts a download.

## CLI Binary

### Pre-built binaries

Download the latest release for your platform from [GitHub Releases](https://github.com/KaiErikNiermann/LangCheck/releases).

Available targets:
- `x86_64-unknown-linux-gnu` — Linux x86_64
- `aarch64-unknown-linux-gnu` — Linux ARM64
- `x86_64-apple-darwin` — macOS Intel
- `aarch64-apple-darwin` — macOS Apple Silicon
- `x86_64-pc-windows-msvc.exe` — Windows x86_64

### From source

```bash
git clone https://github.com/KaiErikNiermann/LangCheck.git
cd LangCheck/rust-core
cargo build --release
```

The binary will be at `target/release/language-check-server`.

### Verify the download

Each release includes `.sha256` checksum files:

```bash
sha256sum -c language-check-server-x86_64-unknown-linux-gnu.sha256
```
