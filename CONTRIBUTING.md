# Contributing to Language Check

Thanks for your interest in contributing! This guide covers the development workflow, code standards, and how to submit changes.

## Getting Started

1. Fork and clone the repository
2. Install prerequisites:
   - Rust 2024 edition (1.85+)
   - Node.js 18+ and pnpm
   - Protobuf compiler (`protoc`)
   - [Lefthook](https://github.com/evilmartians/lefthook) for git hooks: `lefthook install`
3. Build both components:
   ```sh
   cd rust-core && cargo build
   cd ../extension && pnpm install && pnpm run proto:gen && pnpm build
   ```

## Development Workflow

### Branching

- Create a feature branch from `main`
- Use descriptive branch names: `feat/wasm-plugins`, `fix/spelling-false-positive`, `docs/cli-reference`

### Making Changes

**Rust core** (`rust-core/`):
- Run `cargo check` frequently during development
- Add tests for new functionality — unit tests alongside the code, snapshot tests with [insta](https://insta.rs/)
- Run `cargo clippy -- -D warnings` before committing (the project uses strict clippy settings)
- Format with `cargo fmt`

**VS Code extension** (`extension/`):
- Run `pnpm build` to check for TypeScript errors
- Add tests in `src/test/` using [Vitest](https://vitest.dev/)
- Run `pnpm lint` for ESLint checks

**Protobuf changes** (`proto/`):
- Edit `proto/checker.proto`
- Regenerate Rust types: `cd rust-core && cargo build` (prost-build runs automatically)
- Regenerate TypeScript types: `cd extension && pnpm run proto:gen`

### Testing

Run the full test suite before submitting:

```sh
# Rust
cd rust-core
cargo test

# Extension
cd extension
pnpm test
```

Lefthook pre-push hooks will also run these checks automatically.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add WASM plugin discovery from config directory
fix: prevent false positive on contractions in Harper
docs: document external provider JSON protocol
refactor: extract prose ranges into shared utility
test: add snapshot tests for LaTeX prose extraction
chore: update tree-sitter-markdown to 0.8.0
```

## Code Standards

### Rust

- Edition 2024, strict clippy (pedantic + nursery)
- Use `anyhow::Result` for fallible functions
- Prefix rule IDs with the engine name: `harper.`, `languagetool.`, `external.<name>.`, `wasm.<name>.`
- Keep engine implementations behind the `Engine` trait in `engines.rs`
- Configuration structs live in `config.rs` and derive `Serialize`/`Deserialize`

### TypeScript

- Strict mode with `exactOptionalPropertyTypes`
- Use `vscode.l10n.t()` for all user-facing strings
- Message types go in `events.ts`
- Webview components use Svelte 5 with Tailwind utility classes

### General

- No unnecessary dependencies — justify new crates/packages in the PR description
- Keep functions focused; avoid over-abstraction
- Write tests for bug fixes (regression tests) and new features

## Architecture Overview

```
┌────────────────────────┐     protobuf/stdio     ┌─────────────────────┐
│   VS Code Extension    │◄──────────────────────►│    Rust Core        │
│                        │                         │                     │
│  extension.ts          │                         │  orchestrator.rs    │
│  client.ts (IPC)       │                         │  ├─ HarperEngine    │
│  api.ts (public API)   │                         │  ├─ LangToolEngine  │
│  webview/ (Svelte)     │                         │  ├─ ExternalEngine  │
│                        │                         │  └─ WasmEngine      │
└────────────────────────┘                         │                     │
                                                   │  prose.rs (tree-sitter)
                                                   │  rules.rs (normalizer)
                                                   │  workspace.rs (redb)
                                                   └─────────────────────┘
```

The extension spawns the core binary as a child process. They communicate via length-prefixed Protobuf messages on stdin/stdout. The core runs checking engines, normalizes rule IDs, applies severity overrides, deduplicates results, and returns diagnostics.

## Adding a New Engine

1. Implement the `Engine` trait in `rust-core/src/engines.rs`
2. Add configuration fields to `EngineConfig` in `config.rs`
3. Wire it into `initialize_engines()` in `orchestrator.rs`
4. Add rule ID mappings to `data/` if applicable
5. Write tests and update documentation

## Adding a New Supported Language (File Type)

1. Add the tree-sitter parser crate to `Cargo.toml`
2. Add a prose extraction query in `prose.rs`
3. Register the language ID in the extension's `supportedLanguages` array
4. Update `activationEvents` in `package.json` if needed
5. Add snapshot tests for prose extraction

## Translating

We use [Crowdin](https://crowdin.com/project/language-check) for managing translations of both the VS Code extension UI and the documentation. See the [localization guide](https://kaierikniermann.github.io/lang-check/guide/localization.html) for details on how to contribute translations, add new languages, or translate `.po` files locally.

Run `just check-l10n` to verify translation files are in sync before submitting.

## Submitting a Pull Request

1. Ensure all tests pass locally
2. Write a clear PR description explaining **what** and **why**
3. Reference any related issues
4. Keep PRs focused — one feature or fix per PR

## Reporting Issues

- Use GitHub Issues
- Include: OS, VS Code version, extension version, and steps to reproduce
- For false positives, include the text that triggered the issue and the rule ID shown in the diagnostic

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
