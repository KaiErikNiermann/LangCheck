# Inline Directives

lang-check supports inline comment directives that control checking behavior
within specific regions of a document. Directives are placed inside comments
using any of the four supported comment formats.

## Comment Formats

All directives work inside these comment styles:

| Format | Syntax |
|--------|--------|
| HTML / Markdown | `<!-- directive -->` |
| Line comment | `// directive` |
| Block comment | `/* directive */` |
| LaTeX | `% directive` |

## Basic Directives

### Disable / Enable

Suppress all (or specific) diagnostics between a disable and enable pair:

```markdown
<!-- lang-check-disable -->
This text is not checked.
<!-- lang-check-enable -->
```

With rule IDs:

```markdown
<!-- lang-check-disable spelling.typo grammar.article -->
Only spelling and grammar.article rules are suppressed here.
<!-- lang-check-enable -->
```

An unclosed `lang-check-disable` extends to the end of the file.

### Disable Next Line

Suppress diagnostics on the line immediately following the directive:

```markdown
<!-- lang-check-disable-next-line -->
This single line is not checked.
This line IS checked.
```

With rule IDs:

```markdown
// lang-check-disable-next-line spelling.typo
onlySpellingRuleSuppressedHere
```

## Scoped Begin / End

The `lang-check-begin` / `lang-check-end` directives define scoped regions
with richer options than basic disable/enable.

```markdown
<!-- lang-check-begin [OPTIONS] -->
Content in the scoped region.
<!-- lang-check-end -->
```

An unclosed `lang-check-begin` extends to the end of the file.

### Options

Options are space-separated tokens after `lang-check-begin`.

#### Rule IDs

Bare tokens (not matching any option prefix) are treated as rule IDs.
Only those rules are suppressed within the region:

```markdown
<!-- lang-check-begin spelling.typo -->
Only spelling.typo is suppressed here.
<!-- lang-check-end -->
```

With no rule IDs and no language override, all diagnostics in the region
are suppressed.

#### Language Override (`lang:xx`)

Override the natural language for the region. The checker uses this language
instead of the document default. Takes precedence over `<!-- lang: xx -->`
scope markers.

```markdown
<!-- lang-check-begin lang:fr -->
Ceci est du texte français.
<!-- lang-check-end -->
```

A region with **only** a `lang:` option (no rule IDs) acts as a pure
language override — it does not suppress any diagnostics.

#### Line Count (`check[curr:N]`)

Auto-close the region after N lines. No `lang-check-end` is needed:

```markdown
<!-- lang-check-begin check[curr:5] lang:de -->
Fünf Zeilen auf Deutsch.
Zweite Zeile.
Dritte Zeile.
Vierte Zeile.
Fünfte Zeile.
```

The region covers exactly the next N lines after the directive.

#### Match Filter (`match:/PATTERN/`)

Only apply the directive to lines matching the given regex:

```markdown
<!-- lang-check-begin spelling.typo match:/^>\s/ -->
> Quoted text where spelling is suppressed.
Normal text is still checked.
<!-- lang-check-end -->
```

#### Exclude Filter (`exclude:/PATTERN/`)

Skip lines matching the given regex — the directive does not apply to them:

```markdown
<!-- lang-check-begin exclude:/TODO/ -->
This text is suppressed.
TODO: but this line is still checked.
<!-- lang-check-end -->
```

#### Type Override (`type:FORMAT`)

Re-parse the region using a different tree-sitter grammar. The content
inside the region is extracted as if it were a standalone document of the
specified format:

```markdown
<!-- lang-check-begin type:latex -->
\emph{This region} uses \textbf{LaTeX} parsing rules.
<!-- lang-check-end -->
```

The format must be a supported language ID (e.g. `latex`, `html`, `rst`,
`org`). Unknown formats are skipped with a warning.

### Combining Options

Multiple options can be combined in a single directive:

```markdown
<!-- lang-check-begin lang:de spelling.typo check[curr:3] -->
Drei Zeilen auf Deutsch, nur Rechtschreibung unterdrückt.
Zweite Zeile.
Dritte Zeile.
```

### Nesting

Begin/end regions can be nested. The inner `lang-check-end` closes the
most recent `lang-check-begin` (stack semantics):

```markdown
<!-- lang-check-begin -->
All rules suppressed.
<!-- lang-check-begin spelling.typo -->
Only spelling suppressed here.
<!-- lang-check-end -->
Back to all rules suppressed.
<!-- lang-check-end -->
```

## Interaction with Legacy Scope Markers

The `<!-- lang: xx -->` scope markers from `scoping.rs` continue to work.
When both systems specify a language for the same position, the
`lang-check-begin lang:xx` directive takes precedence.
