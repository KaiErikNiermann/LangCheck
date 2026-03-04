#!/usr/bin/env bash
# Verify that locally-installed tool versions match what CI uses.
# This prevents "green locally, red in CI" surprises caused by
# version drift between a developer's machine and GitHub Actions.
#
# Called by lefthook pre-push before any lint/test commands run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
errors=0

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    red "✗ $label: expected $expected, got $actual"
    errors=$((errors + 1))
  else
    green "✓ $label: $actual"
  fi
}

# ── Node.js major version ──
# CI pins node-version: 20 in all workflows.
MIN_NODE_MAJOR=20

if command -v node >/dev/null 2>&1; then
  node_version=$(node --version)          # e.g. v20.18.0
  node_major=${node_version#v}            # 20.18.0
  node_major=${node_major%%.*}            # 20
  if [[ "$node_major" -ge "$MIN_NODE_MAJOR" ]]; then
    green "✓ Node.js major: $node_major (>= $MIN_NODE_MAJOR)"
  else
    red "✗ Node.js major: $node_major (need >= $MIN_NODE_MAJOR)"
    errors=$((errors + 1))
  fi
else
  red "✗ node not found on PATH"
  errors=$((errors + 1))
fi

# ── pnpm version ──
# Pinned in extension/package.json → "packageManager": "pnpm@X.Y.Z"
expected_pnpm=$(
  grep -o '"packageManager":[[:space:]]*"pnpm@[^"]*"' "$REPO_ROOT/extension/package.json" \
    | grep -o '[0-9][0-9.]*'
)

if command -v pnpm >/dev/null 2>&1; then
  actual_pnpm=$(pnpm --version)           # e.g. 10.14.0
  check "pnpm" "$expected_pnpm" "$actual_pnpm"
else
  red "✗ pnpm not found on PATH"
  errors=$((errors + 1))
fi

# ── Rust toolchain channel ──
# CI uses dtolnay/rust-toolchain@stable everywhere.
# We only check that the active toolchain is on the stable channel,
# not a specific point release (CI doesn't pin one either).
if command -v rustup >/dev/null 2>&1; then
  active_toolchain=$(rustup show active-toolchain 2>/dev/null || true)
  # Output looks like: "stable-x86_64-unknown-linux-gnu (default)"
  if [[ "$active_toolchain" == stable* ]]; then
    green "✓ Rust toolchain: stable"
  else
    channel=${active_toolchain%% *}
    red "✗ Rust toolchain: expected stable, got $channel"
    errors=$((errors + 1))
  fi
elif command -v rustc >/dev/null 2>&1; then
  dim "⚠ rustup not found; cannot verify toolchain channel (rustc is present)"
else
  red "✗ rustc not found on PATH"
  errors=$((errors + 1))
fi

# ── Summary ──
echo ""
if [[ $errors -gt 0 ]]; then
  red "Tool version check failed ($errors mismatch(es))."
  red "Fix your local tooling or update the expected versions in CI / package.json."
  exit 1
else
  green "All tool versions match CI."
fi
