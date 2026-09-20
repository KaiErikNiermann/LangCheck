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

Check the region in another natural language. Every prose range that starts
inside it is checked in that language; the rest of the document keeps
`engines.spell_language`.

```markdown
<!-- lang-check-begin lang:fr -->
Ceci est du texte français.
<!-- lang-check-end -->
```

A region with **only** a `lang:` option (no rule IDs) is a pure language
override — it suppresses nothing.

Regions nest, and the innermost one wins. A `lang:` directive also beats
whatever the markup itself declares, which is how one quoted passage inside a
`#set text(lang: "de")` document gets checked in another language without
touching the typesetting.

A tag with no region is resolved before it reaches the engines. It takes the
document default's region when the language agrees — `lang:en` under an
`en-GB` document means `en-GB` — and a known variant otherwise. This matters:
LanguageTool accepts bare `en` and `de` and then reports no spelling errors at
all in them, so an unresolved tag silently checks nothing.

An engine that cannot read the language says so rather than passing the text.
LanguageTool has no Hebrew, so a `lang:he` region produces a
`languagecheck.no-provider` diagnostic naming the language, and the
LanguageTool engine is *not* marked unhealthy for declining it.

#### Line Slice (`check[a:b]`)

Auto-close the region using slice notation. No `lang-check-end` is needed.
`a` and `b` are 0-indexed line offsets after the directive (like Python slicing):

```markdown
<!-- lang-check-begin check[:5] lang:de -->
Fünf Zeilen auf Deutsch.          <!-- line 0 -->
Zweite Zeile.                     <!-- line 1 -->
Dritte Zeile.                     <!-- line 2 -->
Vierte Zeile.                     <!-- line 3 -->
Fünfte Zeile.                     <!-- line 4 -->
```

`check[:5]` covers lines 0–4 (the first 5 lines). You can also start from an
offset — `check[2:5]` would cover only lines 2–4:

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
<!-- lang-check-begin lang:de spelling.typo check[:3] -->
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

## Scope markers

A bare `lang:` marker on its own line switches the language from there until
the next marker, with no closing directive:

```markdown
English up here.

<!-- lang: fr -->

Et du français jusqu'au marqueur suivant.

<!-- lang: en-GB -->

English again.
```

The comment syntax follows the file: `<!-- lang: fr -->`, `// @lang: fr`,
`/* @lang: fr */`, `% @lang: fr`. Prose before the first marker keeps
`engines.spell_language`.

Where both apply to the same position, `lang-check-begin lang:xx` wins — it
names a region, the marker only names a point.

## Languages the markup declares itself

Some formats already carry the information, and it is read directly — no
directive needed:

| Format | Declaration |
| --- | --- |
| Typst | `#set text(lang: "fr", region: "CH")` for the rest of the enclosing block, and `#text(lang: "en")[…]` for that content |

Typst's `region:` becomes the BCP-47 subtag, so `lang: "de", region: "CH"` is
checked as `de-CH`. Only `text` is read; `lang` means something else on other
functions.

A directive beats the markup, so a document can keep its typesetting language
and still have one passage checked in another.
