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
- **One description of the markup between words** -- what may appear in the gap
  between two prose words is written once, as a `gap::Syntax` function, and both
  the "do these words join up" test and the exclusion zones are derived from it.
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

```text
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
- Keep the `_node` choice in priority order—more specific constructs first.

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

### Step D: Declare the grammar binding

All vendored grammars share one module, `rust-core/src/grammars.rs`. Add a line
to the `vendored_grammars!` invocation there:

```rust
vendored_grammars! {
    BIBTEX => tree_sitter_bibtex,
    FORESTER => tree_sitter_forester,
    ORG => tree_sitter_org,
    TINYLANG => tree_sitter_tinylang,
    TYPST => tree_sitter_typst,
}
```

The macro writes the `extern "C"` declaration and the `LanguageFn` that wraps
it. The symbol name **must** follow the convention `tree_sitter_<grammar_name>`,
where `<grammar_name>` matches the `name` field in `grammar.js` -- that is the
symbol the compiled `parser.c` exports.

Nothing else is needed: there is no per-language module to create and no entry
to add to `lib.rs`.

### Step E: Write the prose extractor module

Create `rust-core/src/prose/tinylang.rs`. The module answers two questions, and
they are separate:

1. **Which nodes carry prose?** An AST walk collects the byte ranges of the
   text leaves, skipping subtrees that hold code, math or metadata.
2. **What is in the space between two of them?** That space is a *gap*, and a
   single function describes what markup can appear there.

**1. Configuration constants** -- node kinds and command names that control what
the walk skips:

```rust
use tree_sitter::Node;

use super::{ProseRange, gap, shared};

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

**2. AST walk** -- collect the `text` leaves, then hand the result to
`shared::merge_ranges` along with the gap syntax from part 3:

```rust
pub fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_prose_nodes(root, text, false, &mut word_ranges);
    shared::merge_ranges(&word_ranges, text, tinylang_gap)
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

A "first labeled child" lookup—a command's `command_name`, a directive's
`type` -- is `shared::child_of_kind`, not a hand-written loop:

```rust
fn is_structural_command(node: Node, text: &str) -> bool {
    shared::child_of_kind(node, "command_name")
        .is_some_and(|name| STRUCTURAL_COMMANDS.contains(&&text[name.byte_range()]))
}
```

**3. Gap syntax** -- the one function a new language has to write.

A gap is the source between two prose words, and it decides two things: whether
those words belong to the same prose block, and which byte ranges the checker
must not see. Both come from the same question -- *what token starts here?* --
so the language answers it once, as a `gap::Syntax` function, and
`gap::strip` and `gap::exclusions` derive the rest:

```rust
fn tinylang_gap(b: &[u8], i: usize) -> Option<gap::Match> {
    use gap::Token::{Elided, Separator};
    Some(match b[i..] {
        // Display math: $$...$$
        [b'$', b'$', ..] => gap::Match::at(Separator, i, shared::close_at(b, i + 2, b"$$", None)),
        // Inline math: $...$ — a newline ends it, so an unpaired `$` in prose
        // cannot swallow the rest of the gap.
        [b'$', ..] => gap::Match::at(Separator, i, delimited_end(b, i + 1, b'$', |c| c == b'\n')),
        // Code span: `...`
        [b'`', ..] => gap::Match::at(Separator, i, shared::close_at(b, i + 1, b"`", None)),
        // Command: @name{args}
        [b'@', first, ..] if first.is_ascii_alphabetic() => {
            let name_end = shared::run_end(b, i + 1, |c| {
                c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')
            });
            let end = if b.get(name_end) == Some(&b'{') {
                shared::skip_balanced_bytes(b, name_end + 1, b'{', b'}', None)
            } else {
                name_end
            };
            gap::Match::at(Elided, i, end)
        }
        // Comment: // to the end of the line. Eliding it leaves the newlines on
        // either side adjacent, so a comment on its own line reveals the
        // paragraph break it was hiding.
        [b'/', b'/', ..] => gap::Match::at(Elided, i, shared::run_end(b, i, |c| c != b'\n')),
        // Emphasis and heading markers carry no text of their own.
        [b'*' | b'_' | b'#', ..] => gap::Match::at(Elided, i, i + 1),
        _ => return None,
    })
}
```

Points worth copying:

- **Return `None` for ordinary text.** Anything the function does not recognize
  is prose, and the scan advances one character.
- **Match on `b[i..]`, not on indices.** The slice pattern carries the bounds
  check, so there is no `i + 1 < len` to forget. `[b'/', b'/', ..]` needs two
  bytes present; a lone trailing `/` falls through to `_` on its own.
- **Order the arms longest-prefix first.** `$$` before `$`, `//` before a bare
  marker. The first matching arm wins.
- **`end` must be greater than `i`,** or the scan cannot make progress.
- **Work on bytes.** Every delimiter above is single-byte ASCII, so a byte
  offset that matches is always a character boundary, and non-ASCII prose passes
  through untouched.

The token kind says what the checker should see in that range:

| Kind | Stripped to | Use for |
| --- | --- | --- |
| `Separator` | a space | math, verbatim, code spans—markup that keeps the words on either side apart, so `a $x$ b` is not read as `ab` |
| `Elided` | nothing | command names, escapes, comments—markup that is invisible in the rendered document, so `@em{a}b` is read as `ab` |
| `Barrier` | itself | block structure, where the two sides are different paragraphs and must not be joined at all |

Every token also becomes an exclusion zone, blanked out of the text the checker
receives so its bytes are never reported as a mistake. `gap::exclusions`
guarantees those ranges come out sorted and disjoint, clamping a token that
reaches back for the whitespace before it (LaTeX display math does this, so that
blanking a formula does not leave a double space mid-sentence).

Common helpers, so a scanner does not grow its own copy:

| Need | Helper |
| --- | --- |
| Run of bytes matching a predicate | `shared::run_end(b, i, pred)` |
| Run up to and including a closing delimiter | `shared::close_at(b, i, close, escape)` |
| Balanced `{...}`, escape-aware | `shared::skip_balanced_bytes(b, i, open, close, escape)` |
| A command's `{}` / `[]` arguments | `shared::skip_command_args_bytes(b, i, pairs)` |

### Step F: Wire into the dispatch (`prose/mod.rs`)

Register the new module and add a match arm in `ProseExtractor::extract`:

```rust
// At the top of rust-core/src/prose/mod.rs:
mod tinylang;

// In the extract() method:
let ranges = match lang_id {
    "latex" => latex::extract(text, root, latex_extras),
    "sweave" => sweave::extract(text, root, latex_extras),
    "forester" => forester::extract(text, root),
    "tinylang" => tinylang::extract(text, root),
    // ... one arm per dedicated extractor ...
    lang => query::extract(text, root, &self.language, lang)?,
};
```

`extract` then runs `shared::merge_continuations` over whatever the arm
returned, which rejoins a sentence that was split across a markup boundary. That
happens for every language, so an extractor does not do it itself.

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

**3. Language ID aliases** (optional)—if VS Code or other editors use a
different name for your language, add an entry to `LANGUAGE_ID_ALIASES`:

```rust
const LANGUAGE_ID_ALIASES: &[(&str, &str)] = &[
    ("mdx", "markdown"),
    ("xhtml", "html"),
    // ("mytinylang", "tinylang"),  // if needed
];
```

### Step H: Update `build.rs`

`build.rs` compiles the vendored parsers in one loop. Add the grammar's name to
the list:

```rust
for name in ["forester", "tinylang", "org", "typst"] {
    let dir = format!("tree-sitter-{name}/src");
    // ... cc::Build over parser.c and scanner.c ...
}
```

A grammar with no external scanner gets its own block instead, as BibTeX does—
the loop compiles `scanner.c` unconditionally.

The library name `cc` is given must match the `tree_sitter_<name>` symbol the
binding in Step D declares, which is why both are keyed on the grammar name.

### Step I: Resolve the language ID to a grammar

`languages::resolve_ts_language` maps a canonical language ID to its tree-sitter
`Language`. Both binaries and the LSP server go through it, so there is one arm
to add, not one per binary:

```rust
pub fn resolve_ts_language(lang: &str) -> tree_sitter::Language {
    match lang {
        "html" => tree_sitter_html::LANGUAGE.into(),
        "latex" | "sweave" => codebook_tree_sitter_latex::LANGUAGE.into(),
        "forester" => crate::grammars::FORESTER.into(),
        "tinylang" => crate::grammars::TINYLANG.into(),
        // ... one arm per grammar ...
        _ => tree_sitter_md::LANGUAGE.into(),
    }
}
```

An unknown ID falls back to Markdown rather than failing, so a misconfigured
extension still gets sensible prose extraction.

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

**2. `extension/src/checking/languages.ts`** -- add your language ID to
the `SUPPORTED_LANGUAGES` array:

```typescript
export const SUPPORTED_LANGUAGES: readonly string[] = [
    'markdown', 'html', 'latex', 'forester', 'tinylang', 'rst', 'sweave', 'bibtex', 'org', 'typst', 'mdx', 'xhtml',
];
```

This array controls which VS Code language IDs the extension checks, and
which ones its inlay hint, inline completion and quick fix providers
register for. The server-side `resolve_language_id` handles any
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
    let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
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
    let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
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
    let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
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
| `rust-core/tree-sitter-<lang>/grammar.js` | Create—tree-sitter grammar |
| `rust-core/tree-sitter-<lang>/package.json` | Create—tree-sitter project metadata |
| `rust-core/tree-sitter-<lang>/src/scanner.c` | Create (if needed)—external scanner |
| `rust-core/tree-sitter-<lang>/src/parser.c` | Generated -- `tree-sitter generate` |
| `rust-core/tree-sitter-<lang>/src/*.json` | Generated—grammar/node-types metadata |
| `rust-core/tree-sitter-<lang>/src/tree_sitter/*.h` | Generated—tree-sitter headers |
| `rust-core/src/grammars.rs` | Edit—add a `vendored_grammars!` entry |
| `rust-core/src/prose/<lang>.rs` | Create—AST walk plus one `gap::Syntax` function |
| `rust-core/src/prose/mod.rs` | Edit—add `mod <lang>;` and match arm |
| `rust-core/src/languages.rs` | Edit—extension mapping, supported IDs, `resolve_ts_language` arm |
| `rust-core/build.rs` | Edit—add the grammar name to the compile loop |
| `extension/package.json` | Edit—add `onLanguage:<lang>` activation event |
| `extension/src/checking/languages.ts` | Edit—add to `SUPPORTED_LANGUAGES` |
