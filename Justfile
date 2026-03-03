set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List recipes
default:
    @just --list

# --- Development setup ---

# Install lefthook hooks and prepare dev environment
dev:
    lefthook install
    @echo "Development environment ready!"

# --- Rust ---

# Build rust-core
build-rust:
    cd rust-core && cargo build

# Run rust tests
test-rust:
    cd rust-core && cargo test

# Run clippy
clippy:
    cd rust-core && cargo clippy -- -D warnings

# Check rust formatting
fmt-check:
    cd rust-core && cargo fmt --check

# Fix rust formatting
fmt:
    cd rust-core && cargo fmt

# Run cargo deny (advisories, licenses, bans)
deny:
    cd rust-core && cargo deny check

# Run all rust checks
check-rust: fmt-check clippy test-rust deny

# --- TypeScript ---

# Install extension dependencies
install-ts:
    cd extension && pnpm install --frozen-lockfile

# Build extension
build-ts: install-ts
    cd extension && pnpm run build

# Type check extension
typecheck-ts: install-ts
    cd extension && pnpm run typecheck

# Lint extension
lint-ts: install-ts
    cd extension && pnpm run lint

# Fix lint issues
lint-ts-fix: install-ts
    cd extension && pnpm run lint -- --fix

# Run all TypeScript checks
check-ts: typecheck-ts lint-ts build-ts

# --- Docs ---

# Build docs locally
docs:
    cd docs && pip install -q -r requirements.txt && sphinx-build -b html . _build/html

# Serve docs locally with live reload
docs-serve:
    cd docs && pip install -q -r requirements.txt sphinx-autobuild && sphinx-autobuild . _build/html

# --- Combined ---

# Run all checks (rust + TypeScript)
check: check-rust check-ts

# Clean build artifacts
clean:
    cd rust-core && cargo clean
    rm -rf extension/out extension/node_modules
    rm -rf docs/_build

# --- Versioning & Release ---

# Show current version
version:
    @grep '^version' rust-core/Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/'

# Bump version, sync, commit, tag, push, create GitHub release
release bump="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    current=$(grep '^version' rust-core/Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/')
    IFS='.' read -r major minor patch <<< "$current"
    case "{{bump}}" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) echo "Invalid bump type: {{bump}} (use major, minor, or patch)"; exit 1 ;;
    esac
    version="$major.$minor.$patch"
    just _release "$version"

# Release with an explicit version
release-version version:
    @just _release "{{version}}"

# Re-tag HEAD and re-trigger the release workflow for an existing version
rerun version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    git push
    git tag -d "v$version" 2>/dev/null || true
    git push --delete origin "v$version" 2>/dev/null || true
    git tag "v$version"
    git push origin "v$version"
    echo "Re-triggered release workflow for v$version"

# Delete and recreate the GitHub release + retag HEAD
rerelease version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    gh release delete "v$version" -y 2>/dev/null || true
    just rerun "$version"
    gh release create "v$version" --title "v$version" --generate-notes

# Internal: sync versions across all files, commit, tag, push, create release
_release version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    just _sync-versions "$version"
    (cd rust-core && cargo check 2>/dev/null)  # regenerate Cargo.lock
    git add rust-core/Cargo.toml extension/package.json docs/conf.py
    git add -f rust-core/Cargo.lock 2>/dev/null || true
    git commit -m "chore(release): v$version"
    git push
    git tag "v$version"
    git push origin "v$version"
    gh release create "v$version" --title "v$version" --generate-notes
    echo "Release v$version created — GitHub Actions will build, publish to crates.io, VS Code Marketplace, and Homebrew"

# Internal: update version in all project files
_sync-versions version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    # rust-core/Cargo.toml
    sed -i "0,/^version = .*/s//version = \"$version\"/" rust-core/Cargo.toml
    # extension/package.json
    (cd extension && npm version "$version" --no-git-tag-version --allow-same-version)
    # docs/conf.py
    sed -i "s/^release = .*/release = \"$version\"/" docs/conf.py
    echo "Synced all versions to v$version"

# --- Publishing (dry-run) ---

# Dry-run crate publish
publish-crate-dry:
    #!/usr/bin/env bash
    set -euo pipefail
    cd rust-core
    mkdir -p proto && cp ../proto/checker.proto proto/
    cargo publish --dry-run --allow-dirty
    rm -rf proto

# Publish crate to crates.io
publish-crate:
    #!/usr/bin/env bash
    set -euo pipefail
    cd rust-core
    mkdir -p proto && cp ../proto/checker.proto proto/
    cargo publish --allow-dirty
    rm -rf proto

# Dry-run VSIX packaging (lists files)
publish-vsix-dry:
    cd extension && npx @vscode/vsce ls --no-dependencies

# Build, package, and publish VSIX to VS Code Marketplace
publish-vsix: build-ts
    cd extension && npx @vscode/vsce package --no-dependencies && npx @vscode/vsce publish --packagePath *.vsix

# Run all dry-run checks for publishing
release-dry: publish-crate-dry publish-vsix-dry
    @echo "All publish dry-runs passed"

# Wait for the release workflow to finish
wait-release:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Waiting for Release workflow..."
    run_id=$(gh run list --workflow "Release" --limit 1 --json databaseId -q '.[0].databaseId')
    gh run watch "$run_id" --exit-status && \
        echo "Release workflow succeeded" || \
        { echo "Release workflow failed"; exit 1; }
