# Adding Language Support via the Plugin Path

This guide walks through adding full AST-aware language support to lang-check.
It uses **TinyLang** (the project's reference demo language) as a running example.

## Overview

The plugin path gives a language first-class integration with lang-check:

- **AST-aware prose extraction** -- tree-sitter parses the document, and a Rust
  module walks the syntax tree to collect only the nodes that contain
  human-written prose.
- **Math exclusion zones** -- inline and display math are recognized by the
  grammar and either skipped entirely or replaced with spaces (preserving byte
  offsets so diagnostics map back correctly).
- **Code block / comment skipping** -- fenced code, inline code, and comments
  are pruned from the AST walk so they never reach the grammar checker.
- **Structural command filtering** -- commands whose arguments are identifiers
  or metadata (e.g. `@import`, `@ref`) are distinguished from commands whose
  arguments are prose (e.g. `@title`, `@note`).

The end result is that lang-check only grammar-checks real prose, with accurate
source positions for every diagnostic.

## Prerequisites

- A working Rust toolchain (`cargo`, `cc` crate for C compilation)
- [tree-sitter CLI](https://tree-sitter.github.io/tree-sitter/creating-parsers)
  (`npm install -g tree-sitter-cli` or `cargo install tree-sitter-cli`)
- Node.js (tree-sitter grammars are authored in JavaScript)

## Step-by-step Guide

Throughout this guide, replace `tinylang` / `TinyLang` / `.tiny` with your
language's name and file extension.

---

### Step A: Write the tree-sitter grammar

Create a directory for the grammar inside `rust-core/`:

```
rust-core/tree-sitter-tinylang/
  grammar.js
  package.json
```

**`package.json`** -- minimal tree-sitter project metadata:

```json
{
  "name": "tree-sitter-tinylang",
  "version": "0.1.0",
  "description": "TinyLang grammar for tree-sitter (demo language for lang-check)",
  "main": "bindings/node",
  "keywords": ["parser", "tree-sitter", "tinylang"],
  "tree-sitter": [
    {
      "scope": "source.tinylang",
      "file-types": ["tiny"]
    }
  ]
}
```

**`grammar.js`** -- the grammar itself. The key decisions are:

1. Expose `text` as a leaf node for prose content.
2. Give non-prose constructs their own node kinds (`code_block`, `inline_math`,
   `comment`, etc.) so the Rust extractor can skip them.
3. Use `externals` if tree-sitter's regex engine cannot handle a construct
   (e.g. cross-line fenced code blocks).

Here is TinyLang's complete grammar:

```js
/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "tinylang",

  extras: $ => [/[ \t\r\n]/],

  externals: $ => [$.code_block],

  rules: {
    source_file: $ => repeat($._node),

    _node: $ => choice(
      $.heading,
      $.command,
      $.display_math,
      $.inline_math,
      $.code_block,
      $.code_span,
      $.link,
      $.comment,
      $.bold,
      $.italic,
      $.text,
    ),

    heading: $ => prec.right(seq(
      token(prec(1, /#{1,6} /)),
      repeat(choice($.bold, $.italic, $.code_span, $.inline_math, $.text)),
    )),

    command: $ => prec.right(seq(
      $.command_name,
      optional($.command_arg),
    )),

    command_name: $ => /@[a-zA-Z][a-zA-Z0-9_-]*/,
    command_arg: $ => seq('{', repeat($._node), '}'),

    link: $ => seq($.link_text, $.link_url),
    link_text: $ => seq('[', repeat(choice($.bold, $.italic, $.text)), ']'),
    link_url:  $ => seq('(', /[^)]*/, ')'),

    bold: $ => seq('*', $.text, '*'),
    italic: $ => seq('_', $.text, '_'),

    code_span: $ => /`[^`\n]*`/,
    inline_math: $ => /\$[^$\n]+\$/,
    display_math: $ => token(seq('$$', /[^$]+/, '$$')),
    comment: $ => /\/\/[^\n]*/,

    // Plain text: runs of non-special characters (lowest precedence)
    text: $ => token(prec(-1, /[^\\\{\}\[\]\(\)\n\t *_`$@#\/]+/)),
  },
});
```

Important patterns to follow:

- **`text`** must be the lowest-precedence token (`prec(-1, ...)`) so that
  special constructs win when there is ambiguity.
- Use `prec.right(...)` for constructs that should consume as much as possible
  (headings, commands).
- Keep the `_node` choice in priority order -- more specific constructs first.

### Step B: Write the external scanner (optional)

If your language has constructs that cannot be expressed with tree-sitter's
regex engine (e.g. cross-line delimited blocks), write an external scanner in C.

TinyLang needs one for `~~~...~~~` code fences:

**`tree-sitter-tinylang/src/scanner.c`**:

```c
#include "tree_sitter/parser.h"

enum TokenType {
    CODE_BLOCK,
};

void *tree_sitter_tinylang_external_scanner_create(void) { return NULL; }
void tree_sitter_tinylang_external_scanner_destroy(void *p) { (void)p; }

unsigned tree_sitter_tinylang_external_scanner_serialize(void *p, char *buf) {
    (void)p; (void)buf;
    return 0;
}

void tree_sitter_tinylang_external_scanner_deserialize(
    void *p, const char *buf, unsigned len
) {
    (void)p; (void)buf; (void)len;
}

bool tree_sitter_tinylang_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols
) {
    (void)payload;
    if (!valid_symbols[CODE_BLOCK]) return false;

    // Skip whitespace
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == '\n') {
        lexer->advance(lexer, true);
    }

    // Match opening ~~~
    if (lexer->lookahead != '~') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '~') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '~') return false;
    lexer->advance(lexer, false);

    // Consume until closing ~~~
    int tilde_count = 0;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '~') {
            tilde_count++;
            lexer->advance(lexer, false);
            if (tilde_count == 3) {
                lexer->result_symbol = CODE_BLOCK;
                return true;
            }
        } else {
            tilde_count = 0;
            lexer->advance(lexer, false);
        }
    }
    return false;
}
```

The five `tree_sitter_<name>_external_scanner_*` functions are mandatory.
If your scanner is stateless (like this one), the serialize/deserialize
functions can be empty.

### Step C: Generate the parser

From the grammar directory, run:

```sh
cd rust-core/tree-sitter-tinylang
tree-sitter generate
```

This produces:

- `src/parser.c` -- the generated parser
- `src/grammar.json` -- serialized grammar
- `src/node-types.json` -- node type metadata
- `src/tree_sitter/parser.h` (and other headers)

Commit all generated files. They are vendored so that building the project
does not require the tree-sitter CLI.

### Step D: Create the Rust FFI binding

Create `rust-core/src/tinylang_ts.rs`:

```rust
use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_tinylang() -> *const ();
}

pub const LANGUAGE: LanguageFn =
    unsafe { LanguageFn::from_raw(tree_sitter_tinylang) };
```

The `tree_sitter_tinylang` symbol is provided by the compiled `parser.c`.
The function name **must** follow the convention `tree_sitter_<grammar_name>`,
where `<grammar_name>` matches the `name` field in `grammar.js`.

Then register the module in `rust-core/src/lib.rs`:

```rust
pub mod tinylang_ts;
```

### Step E: Write the prose extractor module

Create `rust-core/src/prose/tinylang.rs`. This module receives the parsed
tree-sitter AST and returns a `Vec<ProseRange>` -- the byte ranges of prose
text plus any exclusion zones within those ranges.

The structure has three parts:

**1. Configuration constants** -- lists of node kinds and command names that
control what gets skipped:

```rust
use tree_sitter::Node;
use super::ProseRange;

/// Commands whose arguments contain identifiers/metadata, not prose.
const STRUCTURAL_COMMANDS: &[&str] = &[
    "@author", "@date", "@import", "@ref", "@tag", "@id", "@class",
];

/// Node kinds that are never prose and whose subtrees should be skipped.
const SKIP_KINDS: &[&str] = &[
    "inline_math", "display_math", "code_block",
    "code_span", "comment", "command_name", "link_url",
];
```

**2. AST walk** -- a recursive function that collects `text` leaf node byte
ranges, skipping non-prose subtrees:

```rust
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_prose_nodes(root, text, false, &mut word_ranges);
    merge_ranges(&word_ranges, text)
}

fn collect_prose_nodes(
    node: Node, text: &str, skip: bool, out: &mut Vec<(usize, usize)>,
) {
    let kind = node.kind();

    if SKIP_KINDS.contains(&kind) {
        return;
    }

    if kind == "command" {
        if skip || is_structural_command(node, text) {
            return;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            collect_prose_nodes(child, text, false, out);
        }
        return;
    }

    if kind == "text" {
        if !skip {
            let start = node.start_byte();
            let end = node.end_byte();
            if start < end {
                out.push((start, end));
            }
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose_nodes(child, text, skip, out);
    }
}
```

**3. Range merging** -- adjacent text nodes are merged into sentence-level
chunks. Gaps between text nodes are analyzed: if a gap contains only
whitespace and punctuation (after stripping language-specific noise like math
and commands), the ranges merge. If a gap contains a paragraph break
(`\n\n`), a new `ProseRange` starts.

Math regions within bridgeable gaps are recorded as exclusion zones so the
grammar checker sees spaces instead of math content:

```rust
fn merge_ranges(words: &[(usize, usize)], text: &str) -> Vec<ProseRange> {
    if words.is_empty() {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut chunk_start = words[0].0;
    let mut chunk_end = words[0].1;
    let mut exclusions: Vec<(usize, usize)> = Vec::new();

    for &(start, end) in &words[1..] {
        let gap = &text[chunk_end..start];

        if !is_bridgeable_gap(gap) {
            ranges.push(ProseRange {
                start_byte: chunk_start,
                end_byte: chunk_end,
                exclusions: std::mem::take(&mut exclusions),
            });
            chunk_start = start;
        } else {
            collect_math_exclusions(gap, chunk_end, &mut exclusions);
        }
        chunk_end = end;
    }

    ranges.push(ProseRange {
        start_byte: chunk_start,
        end_byte: chunk_end,
        exclusions,
    });
    ranges
}
```

The `is_bridgeable_gap` and `collect_math_exclusions` helper functions are
language-specific. See `rust-core/src/prose/tinylang.rs` for the full
implementation, including `strip_tinylang_noise` which removes math, commands,
code spans, bold/italic markers, and comments from a gap before testing
whether it is bridgeable.

### Step F: Wire into the dispatch (`prose/mod.rs`)

Register the new module and add a match arm in `ProseExtractor::extract`:

```rust
// At the top of rust-core/src/prose/mod.rs:
mod tinylang;

// In the extract() method:
pub fn extract(&mut self, text: &str, lang_id: &str) -> Result<Vec<ProseRange>> {
    let tree = self.parser.parse(text, None)
        .ok_or_else(|| anyhow!("Failed to parse text"))?;
    let root = tree.root_node();

    match lang_id {
        "latex" => Ok(latex::extract(text, root)),
        "forester" => Ok(forester::extract(text, root)),
        "tinylang" => Ok(tinylang::extract(text, root)),
        lang => query::extract(text, root, &self.language, lang),
    }
}
```

Languages that do not have a dedicated extractor module fall through to the
generic `query`-based extractor (the `lang` catch-all arm). The plugin path
exists for when you need more control than the query path provides.

### Step G: Add to the language registry (`languages.rs`)

Three things to update:

**1. File extension mapping** -- add entries to `BUILTIN_EXTENSIONS`:

```rust
const BUILTIN_EXTENSIONS: &[(&str, &str)] = &[
    // ... existing entries ...
    ("tiny", "tinylang"),
];
```

**2. Supported language IDs** -- add to `SUPPORTED_LANGUAGE_IDS`:

```rust
pub const SUPPORTED_LANGUAGE_IDS: &[&str] = &[
    "markdown", "html", "latex", "forester", "tinylang"
];
```

**3. Language ID aliases** (optional) -- if VS Code or other editors use a
different name for your language, add an entry to `LANGUAGE_ID_ALIASES`:

```rust
const LANGUAGE_ID_ALIASES: &[(&str, &str)] = &[
    ("mdx", "markdown"),
    ("xhtml", "html"),
    // ("mytinylang", "tinylang"),  // if needed
];
```

### Step H: Update `build.rs`

Add a `cc::Build` block to compile the vendored tree-sitter parser:

```rust
// Compile vendored tree-sitter-tinylang parser
let dir = std::path::Path::new("tree-sitter-tinylang/src");
cc::Build::new()
    .include(dir)
    .file(dir.join("parser.c"))
    .file(dir.join("scanner.c"))  // omit if no external scanner
    .warnings(false)
    .compile("tree_sitter_tinylang");
```

The library name passed to `.compile()` must match what the linker expects for
the `tree_sitter_tinylang` extern symbol declared in the FFI binding.

### Step I: Update CLI and server binaries

Both `language-check` (CLI) and `language-check-server` contain a
`resolve_ts_language` function that maps language IDs to tree-sitter
`Language` values. Add an arm for your language in each:

**`rust-core/src/bin/language-check.rs`**:

```rust
fn resolve_ts_language(lang: &str) -> tree_sitter::Language {
    match lang {
        "html" => tree_sitter_html::LANGUAGE.into(),
        "latex" => codebook_tree_sitter_latex::LANGUAGE.into(),
        "forester" => rust_core::forester_ts::LANGUAGE.into(),
        "tinylang" => rust_core::tinylang_ts::LANGUAGE.into(),
        _ => tree_sitter_md::LANGUAGE.into(),
    }
}
```

**`rust-core/src/bin/language-check-server.rs`** -- identical match arm.

### Step J: Update the VS Code extension

Two files need changes:

**1. `extension/package.json`** -- add an activation event so the extension
activates when a file of your language is opened:

```json
"activationEvents": [
    "onLanguage:markdown",
    "onLanguage:html",
    "onLanguage:latex",
    "onLanguage:forester",
    "onLanguage:tinylang"
]
```

**2. `extension/src/extension.ts`** -- add your language ID to the
`supportedLanguages` array:

```typescript
const supportedLanguages = [
    'markdown', 'html', 'latex', 'forester', 'tinylang', 'mdx', 'xhtml'
];
```

This array controls which VS Code language IDs trigger the on-change
diagnostic handler. The server-side `resolve_language_id` handles any
alias resolution.

---

## Testing Strategy

### Unit tests (prose extraction)

Add tests directly in `rust-core/src/prose/mod.rs` under the existing
`#[cfg(test)] mod tests` block. Each test creates a `ProseExtractor`,
feeds it a sample document, and asserts on the extracted prose ranges.

Typical test cases:

```rust
#[test]
fn test_tinylang_basic_extraction() -> Result<()> {
    let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
    let mut extractor = ProseExtractor::new(language)?;
    let text = "This is a simple sentence.\n";
    let ranges = extractor.extract(text, "tinylang")?;
    assert!(!ranges.is_empty(), "Should extract prose from plain text");
    let prose = ranges[0].extract_text(text);
    assert!(prose.contains("simple sentence"));
    Ok(())
}

#[test]
fn test_tinylang_code_excluded() -> Result<()> {
    let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
    let mut extractor = ProseExtractor::new(language)?;
    let text = "Before code.\n\n~~~\nfn main() {}\n~~~\n\nAfter code.\n";
    let ranges = extractor.extract(text, "tinylang")?;
    let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
    assert!(!all_prose.contains("fn main"));
    assert!(all_prose.contains("Before code"));
    Ok(())
}

#[test]
fn test_tinylang_structural_commands_excluded() -> Result<()> {
    let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
    let mut extractor = ProseExtractor::new(language)?;
    let text = "@author{Jane Doe}\n@date{2025-01-01}\n\nSome prose text here.\n";
    let ranges = extractor.extract(text, "tinylang")?;
    let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
    assert!(!all_prose.contains("Jane Doe"));
    assert!(all_prose.contains("prose text here"));
    Ok(())
}
```

Cover at least:

- Plain prose extraction
- Code block exclusion
- Code span exclusion
- Comment exclusion
- Inline math exclusion
- Display math exclusion zones (verify `extract_text` blanks the math)
- Structural vs. prose command distinction
- Sentence bridging across inline math and formatting commands
- Paragraph splitting on `\n\n`

### End-to-end CLI test

Create a sample `.tiny` file and run the CLI:

```sh
cargo run --bin language-check -- check sample.tiny --lang tinylang
```

Verify that:

- Diagnostics appear for intentional typos in prose
- No diagnostics appear for code blocks, comments, or math
- Line/column positions are correct

### Language registry tests

Tests for `detect_language` and friends already exist in
`rust-core/src/languages.rs`. Add a case for your new extension:

```rust
#[test]
fn detect_builtin_tinylang() {
    let config = default_config();
    assert_eq!(detect_language(Path::new("doc.tiny"), &config), "tinylang");
}
```

---

## Files Checklist

When adding a new language via the plugin path, you will touch (or create)
these files:

| File | Action |
|------|--------|
| `rust-core/tree-sitter-<lang>/grammar.js` | Create -- tree-sitter grammar |
| `rust-core/tree-sitter-<lang>/package.json` | Create -- tree-sitter project metadata |
| `rust-core/tree-sitter-<lang>/src/scanner.c` | Create (if needed) -- external scanner |
| `rust-core/tree-sitter-<lang>/src/parser.c` | Generated -- `tree-sitter generate` |
| `rust-core/tree-sitter-<lang>/src/*.json` | Generated -- grammar/node-types metadata |
| `rust-core/tree-sitter-<lang>/src/tree_sitter/*.h` | Generated -- tree-sitter headers |
| `rust-core/src/<lang>_ts.rs` | Create -- FFI binding |
| `rust-core/src/lib.rs` | Edit -- add `pub mod <lang>_ts;` |
| `rust-core/src/prose/<lang>.rs` | Create -- prose extractor |
| `rust-core/src/prose/mod.rs` | Edit -- add `mod <lang>;` and match arm |
| `rust-core/src/languages.rs` | Edit -- extension mapping + supported IDs |
| `rust-core/build.rs` | Edit -- add `cc::Build` for the parser |
| `rust-core/src/bin/language-check.rs` | Edit -- add `resolve_ts_language` arm |
| `rust-core/src/bin/language-check-server.rs` | Edit -- add `resolve_ts_language` arm |
| `extension/package.json` | Edit -- add `onLanguage:<lang>` activation event |
| `extension/src/extension.ts` | Edit -- add to `supportedLanguages` array |
