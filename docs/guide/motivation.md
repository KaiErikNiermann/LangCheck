# Why Language Check?

Most prose linters either lock you into one checking engine, rely on fragile regex heuristics, or ship as slow Electron apps. Language Check takes a different approach.

## Modern, accessible stack

The core is written in Rust and communicates with editors over a lightweight protobuf protocol. The VS Code extension is TypeScript; the Neovim client is Lua. No Java runtime, no hidden Electron process, no language server protocol overhead for simple checks. If you can install a binary and an editor plugin, you're set.

## Engine-agnostic by design

Language Check is not tied to any single checking provider. [Harper](https://github.com/elijah-potter/harper) ships as the default offline engine, and [LanguageTool](https://languagetool.org/) integrates as an optional second engine. Beyond those, an [external provider protocol](../advanced/providers.md) and a [WASM plugin API](../advanced/plugins.md) let you plug in arbitrary checkers — a custom style guide enforcer, a domain glossary validator, or an engine that doesn't exist yet. Diagnostics from every active engine are merged into a single unified stream.

## Fast because it should be

Spell-checking is a background task that should never get in your way. The Rust core runs extraction and checking in parallel, keeps startup instant, and works fully offline by default. LanguageTool adds network latency when enabled, but Harper results appear immediately while LT results stream in behind them.

## Tree-sitter grammars, not regex

Every supported file format — Markdown, LaTeX, HTML, Typst, reStructuredText, Org mode, BibTeX, Forester, R Sweave — is parsed with a proper [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar. The extractor walks the AST to collect prose nodes, skipping code blocks, math environments, macro arguments, and structural commands by the shape of the syntax tree rather than pattern-matching against raw text. This means fewer false positives from fragments that look like prose but aren't, and correct sentence boundaries even in complex documents with nested markup.

For formats that don't yet have a tree-sitter grammar, a regex-based SLS (Simple Language Support) fallback is available — but the goal is always to replace it with a proper grammar.

## Inspectable internals

The extension ships with a built-in **Inspector** panel that shows exactly what's happening under the hood: which prose ranges were extracted, what the clean text looks like after exclusions, per-engine latency, diagnostic summaries, engine health status, and a live event log. This isn't a debug-only feature — it's always available from the command palette. If a diagnostic seems wrong, you can open the Inspector and see exactly which text was sent to which engine and why.

**Protobuf tracing** can be toggled on to log every message between the extension and the core binary, making it straightforward to file a bug report with full reproduction context.

## Workspace-scale checking

Language Check can index and check an entire workspace in one pass. The **SpeedFix** panel lets you batch-process diagnostics across files with keyboard-driven navigation — fix, ignore, or add to dictionary without leaving the flow.
