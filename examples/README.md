# Examples

One directory per markup format. Each holds a document using that format's
constructs, the `.languagecheck.yaml` it is written against, and an
`expected.md` saying what a check reports and — more usefully — what it
deliberately does not.

| Directory | Shows |
| --- | --- |
| [`typst/`](typst/) | A French thesis quoting English and Hebrew. Typst's own `#set text(lang: …)` and `#text(lang: …)[…]` routing each passage to the right language, figures, math, raw blocks, and a `lang:` directive overriding the markup. |
| [`latex/`](latex/) | An English paper with a French quotation. `skip_environments` and `skip_commands`, the preamble rule, the built-in skip set, and `lang:` as the way to mark another language where LaTeX offers no declaration. |
| [`markdown/`](markdown/) | Release notes. The smallest useful config — one offline engine — plus a project wordlist, the name filter, and turning a rule off. |

## Running one

Each directory is a workspace: `cd` into it and the `.languagecheck.yaml` beside
the document is picked up.

```sh
cd markdown && language-check check notes.md
```

`markdown/` and `latex/` use Harper alone and need nothing running. `typst/`
enables LanguageTool, because Harper reads only English; start it with
`docker compose up -d` from the repository root.

## They are also tests

`rust-core/tests/examples_extraction.rs` runs over every directory here and
snapshots what was extracted, which grammar was used and which language each
range would be checked in. It needs no engine and no network. A change to an
extractor that alters any of that shows up as a snapshot diff naming the file
and the line, which is how these files stay documentation for behaviour the
code actually has.

The diagnostics themselves live in each `expected.md` as prose, because which
of them appear depends on which engines are installed.
