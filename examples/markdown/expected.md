# What a check of `notes.md` reports

Run from this directory, with nothing else running — Harper needs no server:

```sh
language-check check notes.md
```

| Line | Rule | Why |
| --- | --- | --- |
| 8 | `spelling.typo` | `deliberatly` in body text. |
| 22 | `spelling.typo` | `mispelling` in a link's text. The text is prose; the URL is not. |
| 24 | `spelling.typo` | `mispellings` in a block quote. A quote is prose like any other paragraph. |
| 52 | `languagecheck.no-provider` | The `lang:de-DE` region has no engine behind it: Harper is English-only and LanguageTool is off in this config. The passage is reported as unchecked instead of passing silently. |
| 58 | `spelling.typo` | `deliberatly` in the closing sentence. |

## What is deliberately not reported

| Where | Why |
| --- | --- |
| `recieve` inside the fenced block | Fenced code is never prose. |
| The `https://example.org` autolink and every URL | A link target is not prose. |
| `mdsvex`, `nanobenchmark` | `project-terms.txt`, named under `dictionaries.paths`. |
| `Niermann`, `Kowalczyk` | The name filter, which needs no wordlist entry. |
| `mispelling` on line 42 | The `lang-check-disable-next-line` above it. |
| `mispelling` on line 47 | Inside `lang-check-begin spelling.typo`, which silences spelling there and leaves every other rule running. |
| Title case on every heading | `rules.typography.capitalization` is set to `off`. |

Turn LanguageTool on in `.languagecheck.yaml` and the German paragraph is
checked in German instead of reported as unchecked.
