# Why Language Check?

Many prose linters depend on one checking engine or fragile regex heuristics. Others run as slow Electron apps. Language Check takes a different approach.

## Modern, accessible stack

The core is written in Rust and communicates with editors over a lightweight protobuf protocol. The VS Code extension uses TypeScript. The Neovim client uses Lua. Simple checks run without a Java runtime or hidden Electron process, and avoid the overhead of the language server protocol. Install a binary and an editor plugin to get started.

## Engine-agnostic by design

Language Check works with multiple checking providers. [Harper](https://github.com/elijah-potter/harper) is the default offline engine, and [LanguageTool](https://languagetool.org/) is available as an optional second engine. You can add other checkers through the [external provider protocol](../advanced/providers.md) or the [WASM plugin API](../advanced/plugins.md). A plugin can enforce a custom style guide or validate a domain glossary. It can also connect to a checker you develop yourself. Diagnostics from all active engines appear in one stream.

## Fast because it should be

Spell-checking is a background task that should never get in your way. The Rust core runs extraction and checking in parallel. Startup is fast, and the default setup works offline. LanguageTool adds network latency when enabled, while Harper results appear immediately and LanguageTool results arrive as they finish.

## Tree-sitter grammars, not regex

Every supported file format — Markdown, LaTeX, HTML, Typst, reStructuredText, Org mode, BibTeX, Forester, R Sweave — is parsed with a proper [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar. The extractor walks the syntax tree to collect prose nodes and skip code blocks, math environments, macro arguments, and structural commands. This approach avoids pattern-matching against raw text. It also helps prevent false positives from non-prose fragments and preserves sentence boundaries in documents with nested markup.

For formats that don't yet have a tree-sitter grammar, a regex-based SLS (Simple Language Support) fallback is available — but the goal is always to replace it with a proper grammar.

## Inspectable internals

The extension includes a built-in **Inspector** panel that shows which prose ranges were extracted, the cleaned text after exclusions, latency for each engine, diagnostic summaries, engine health status, and a live event log. The panel is available from the command palette. If a diagnostic seems wrong, open the Inspector to see which text was sent to each engine and why.

**Protobuf tracing** logs messages between the extension and the core binary when enabled. The log provides context for reproducing a bug report.

## Workspace-scale checking

Language Check can index and check an entire workspace in one pass. The **SpeedFix** panel lets you batch-process diagnostics across files with keyboard-driven navigation — fix, ignore, or add to dictionary without leaving the flow.
