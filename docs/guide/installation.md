# Installation

## VS Code Extension

Install from the VS Code marketplace:

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS)
3. Search for **Language Check**
4. Click **Install**

On first activation, the extension will prompt you to download the core binary for your platform. You can also install it manually.

## CLI Binary

### Pre-built binaries

Download the latest release for your platform from [GitHub Releases](https://github.com/KaiErikNiermann/lang-check/releases).

Available targets:
- `x86_64-unknown-linux-gnu` — Linux x86_64
- `aarch64-unknown-linux-gnu` — Linux ARM64
- `x86_64-apple-darwin` — macOS Intel
- `aarch64-apple-darwin` — macOS Apple Silicon
- `x86_64-pc-windows-msvc.exe` — Windows x86_64

### From source

```bash
git clone https://github.com/KaiErikNiermann/lang-check.git
cd lang-check/rust-core
cargo build --release
```

The binary will be at `target/release/language-check-server`.

### Verify the download

Each release includes `.sha256` checksum files:

```bash
sha256sum -c language-check-server-x86_64-unknown-linux-gnu.sha256
```
