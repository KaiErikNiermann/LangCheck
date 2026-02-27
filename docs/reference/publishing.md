# Package Registry Publishing

Distribution plan for the Language Check CLI binary across package registries.

## crates.io

The Rust crate is published directly from the `rust-core` directory.

```bash
cd rust-core
cargo publish --dry-run
cargo publish
```

**Checklist:**
- Ensure `Cargo.toml` has correct `name`, `version`, `description`, `license`, `repository`
- Add `categories` and `keywords` for discoverability
- Verify `README.md` is included via `readme` field

## Homebrew (macOS/Linux)

### Formula

```ruby
class LanguageCheck < Formula
  desc "Fast multi-engine prose linter for Markdown, HTML, and LaTeX"
  homepage "https://github.com/gemini/lang-check"
  version "0.1.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/gemini/lang-check/releases/download/v0.1.0/language-check-server-aarch64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/gemini/lang-check/releases/download/v0.1.0/language-check-server-x86_64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/gemini/lang-check/releases/download/v0.1.0/language-check-server-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/gemini/lang-check/releases/download/v0.1.0/language-check-server-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  def install
    bin.install "language-check-server"
  end

  test do
    assert_match "language-check", shell_output("#{bin}/language-check-server --version")
  end
end
```

### Tap setup

```bash
# Create a tap repository: homebrew-lang-check
brew tap gemini/lang-check
brew install gemini/lang-check/language-check
```

## winget (Windows)

### Manifest

Create `manifests/g/gemini/language-check/0.1.0/` in the [winget-pkgs](https://github.com/microsoft/winget-pkgs) repository:

**gemini.language-check.yaml:**
```yaml
PackageIdentifier: gemini.language-check
PackageVersion: 0.1.0
PackageName: Language Check
Publisher: Gemini
License: ISC
ShortDescription: Fast multi-engine prose linter
InstallerType: portable
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/gemini/lang-check/releases/download/v0.1.0/language-check-server-x86_64-pc-windows-msvc.exe
    InstallerSha256: PLACEHOLDER
ManifestType: singleton
ManifestVersion: 1.6.0
```

Submit via PR to `microsoft/winget-pkgs`.

## AUR (Arch Linux)

### PKGBUILD

```bash
# Maintainer: Gemini
pkgname=language-check-bin
pkgver=0.1.0
pkgrel=1
pkgdesc="Fast multi-engine prose linter for Markdown, HTML, and LaTeX"
arch=('x86_64' 'aarch64')
url="https://github.com/gemini/lang-check"
license=('ISC')
provides=('language-check')

source_x86_64=("$url/releases/download/v$pkgver/language-check-server-x86_64-unknown-linux-gnu")
source_aarch64=("$url/releases/download/v$pkgver/language-check-server-aarch64-unknown-linux-gnu")
sha256sums_x86_64=('PLACEHOLDER')
sha256sums_aarch64=('PLACEHOLDER')

package() {
    install -Dm755 "language-check-server-"* "$pkgdir/usr/bin/language-check-server"
}
```

### Publishing

```bash
# Clone AUR package
git clone ssh://aur@aur.archlinux.org/language-check-bin.git
cd language-check-bin
# Add PKGBUILD and .SRCINFO
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO
git commit -m "Initial upload: language-check-bin 0.1.0"
git push
```

## Debian/Ubuntu (.deb)

### Using cargo-deb

```bash
cd rust-core
cargo install cargo-deb
cargo deb
```

Add to `Cargo.toml`:
```toml
[package.metadata.deb]
name = "language-check"
maintainer = "Gemini <noreply@gemini.dev>"
depends = "$auto"
section = "text"
priority = "optional"
assets = [
    ["target/release/language-check-server", "/usr/bin/", "755"],
]
```

## Release Automation

### GitHub Actions workflow

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  build:
    strategy:
      matrix:
        include:
          - target: x86_64-unknown-linux-gnu
            os: ubuntu-latest
          - target: aarch64-unknown-linux-gnu
            os: ubuntu-latest
          - target: x86_64-apple-darwin
            os: macos-latest
          - target: aarch64-apple-darwin
            os: macos-latest
          - target: x86_64-pc-windows-msvc
            os: windows-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - run: cargo build --release --target ${{ matrix.target }}
        working-directory: rust-core
      - name: Create checksum
        run: sha256sum target/${{ matrix.target }}/release/language-check-server* > language-check-server-${{ matrix.target }}.sha256
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            rust-core/target/${{ matrix.target }}/release/language-check-server*
            language-check-server-${{ matrix.target }}.sha256

  publish-crate:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo publish --token ${{ secrets.CARGO_TOKEN }}
        working-directory: rust-core

  publish-homebrew:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: dawidd6/action-homebrew-bump-formula@v4
        with:
          token: ${{ secrets.HOMEBREW_TOKEN }}
          formula: language-check
```
