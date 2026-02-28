# TinyLang Specification

TinyLang is a minimal demo markup language designed to showcase how to add
language support to lang-check. It is intentionally trivial — just complex
enough to demonstrate prose extraction, math exclusion, and structural commands.

## File Extension

`.tiny`

## Syntax

### Prose Text

Any text that isn't inside a special construct is **prose** and will be
grammar-checked.

```
This is plain prose text that gets checked.
```

### Headings

Lines starting with one or more `#` characters followed by a space:

```
# Heading 1
## Heading 2
### Heading 3
```

The heading text (after `# `) is prose.

### Bold and Italic

- Bold: `*text*`
- Italic: `_text_`

The text inside markers is prose (markers are stripped for checking).

### Code Spans

Inline code: `` `code` ``

Code content is **not** prose and is excluded from checking.

### Code Blocks

Fenced with `~~~` on their own lines:

```
~~~
fn main() {
    println!("hello");
}
~~~
```

Everything between `~~~` fences is excluded from checking.

### Comments

Line comments starting with `//`:

```
// This is a comment — not checked
```

Comments are excluded from checking.

### Math

Inline math: `$expression$`
Display math: `$$expression$$`

Math content is excluded from checking. Display math creates an exclusion
zone (content replaced with spaces to preserve offsets, same as LaTeX
`\[...\]` and Forester `##{...}`).

### Structural Commands

Commands starting with `@` that take arguments in `{...}`:

```
@title{My Document}
@author{Jane Doe}
@date{2025-01-01}
@import{other-file}
@ref{section-id}
@tag{category}
```

**Structural commands** — arguments are identifiers/metadata, not prose:
- `@author`, `@date`, `@import`, `@ref`, `@tag`, `@id`, `@class`

**Prose commands** — arguments contain prose to check:
- `@title`, `@note`, `@caption`, `@quote`, `@footnote`
- Any unknown `@command` defaults to prose

### Links

Links use `[text](url)` syntax:

```
See [the documentation](https://example.com) for details.
```

The link text (`the documentation`) is prose. The URL is not.

### Paragraphs

Paragraphs are separated by blank lines (`\n\n`). Text within a paragraph
is merged into a single prose range for checking.

## Example Document

```tinylang
@title{A Quick Demo}
@author{Jane Doe}
@date{2025-01-01}

# Introduction

This is a simple document writen in TinyLang. It demonstrates
the basic features of the markup langauge.

// TODO: expand this section

Here is some `inline_code` and a formula: $E = mc^2$.

## Code Example

Below is a code block:

~~~
function greet(name) {
    return "Hello, " + name;
}
~~~

The function above is *not* checked for grammer errors because
it is inside a code fence.

## Math Section

The quadratic formula is:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

This paragraph continues after the display math.

@note{Remember to review this section for _accuracy_ before publishing.}
@ref{appendix-a}
```

## Tree-Sitter Node Types

| Node | Description | Prose? |
|------|-------------|--------|
| `source_file` | Root | — |
| `heading` | `# text` | Heading text is prose |
| `paragraph` | Block of text | Yes |
| `text` | Plain text runs | **Yes** |
| `bold` | `*text*` | Content is prose |
| `italic` | `_text_` | Content is prose |
| `code_span` | `` `code` `` | No |
| `code_block` | `~~~...~~~` | No |
| `comment` | `// ...` | No |
| `inline_math` | `$...$` | No |
| `display_math` | `$$...$$` | No (exclusion zone) |
| `command` | `@name{args}` | Depends on name |
| `command_name` | The `@identifier` | No |
| `command_arg` | `{content}` | Depends on parent |
| `link` | `[text](url)` | Text is prose, URL is not |
| `link_text` | Text inside `[...]` | Yes |
| `link_url` | URL inside `(...)` | No |
