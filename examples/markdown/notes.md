<!--
Notes exercising the Markdown constructs the extractor separates from prose.
Every misspelling is deliberate; expected.md lists them.
-->

# Release notes

Body text is prose and is checked. This paragraph contains a deliberatly
wrong word so the example has something to report.

## What is not prose

Fenced code is never checked:

```python
# A comment inside a fence: never checked.
recieve = "misspelt on purpose"
```

Neither is `inline code`, a [link](https://example.org/release) target, or the
URL in an autolink such as <https://example.org>. The link *text* is prose, so
a mispelling there is reported.

> A block quote is prose. It is checked like any other paragraph, mispellings
> included.

| Column | Meaning                                    |
| ------ | ------------------------------------------ |
| `id`   | Table cells are prose and are checked here. |

## Words a dictionary will not have

The bundled wordlists cover software vocabulary, and `project-terms.txt` adds
the rest: mdsvex renders this site, and the nanobenchmark gate guards the hot
path. Neither is reported.

A person's name is not a misspelling either. The name filter keeps Niermann and
Kowalczyk out of the report without either being in a wordlist.

## Turning the checker off

<!-- lang-check-disable-next-line -->
This line holds a deliberate mispelling and is not reported.

<!-- lang-check-begin spelling.typo -->
Inside this region only spelling is silenced; every other rule still applies.
Here is one more mispelling.
<!-- lang-check-end -->

<!-- A `lang:` directive routes a passage to another language. -->
<!-- lang-check-begin lang:de-DE -->
Dieser Absatz steht auf Deutsch mitten in einem englischen Dokument und wird
auch auf Deutsch geprüft, mit einem absichtlichen Rechtschreibfeler.
<!-- lang-check-end -->

## Done

A final sentence with a deliberatly wrong word.
