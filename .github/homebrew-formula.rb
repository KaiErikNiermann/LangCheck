class LangCheck < Formula
  desc "Multilingual prose linter with tree-sitter extraction and pluggable checking engines"
  homepage "https://github.com/KaiErikNiermann/lang-check"
  version "@@VERSION@@"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/KaiErikNiermann/lang-check/releases/download/v@@VERSION@@/language-check-aarch64-apple-darwin.tar.gz"
      sha256 "@@SHA256_MACOS_ARM64@@"
    else
      url "https://github.com/KaiErikNiermann/lang-check/releases/download/v@@VERSION@@/language-check-x86_64-apple-darwin.tar.gz"
      sha256 "@@SHA256_MACOS_AMD64@@"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/KaiErikNiermann/lang-check/releases/download/v@@VERSION@@/language-check-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "@@SHA256_LINUX_ARM64@@"
    else
      url "https://github.com/KaiErikNiermann/lang-check/releases/download/v@@VERSION@@/language-check-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "@@SHA256_LINUX_AMD64@@"
    end
  end

  def install
    bin.install "language-check"
    bin.install "language-check-server"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/language-check --version")
  end
end
