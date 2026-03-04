#!/usr/bin/env bash
# Neovim headless LSP smoke test wrapper for language-check-server.
#
# Usage: ./nvim-lsp-smoke-test.sh <path-to-language-check-server>
#
# Requires: nvim (Neovim 0.10+)

set -euo pipefail

SERVER_BIN="${1:?Usage: nvim-lsp-smoke-test.sh <server-binary-path>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURES="$SCRIPT_DIR/fixtures"

if ! command -v nvim &>/dev/null; then
    echo "ERROR: nvim not found in PATH"
    exit 1
fi

echo "Neovim version: $(nvim --version | head -1)"
echo "Server binary:  $SERVER_BIN"
echo ""

export SERVER_BIN
export FIXTURES

exec nvim --headless -u NONE -l "$SCRIPT_DIR/nvim-lsp-test.lua"
