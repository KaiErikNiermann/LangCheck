# What a check of `paper.tex` reports

Run from this directory, with nothing else running — Harper needs no server:

```sh
language-check check paper.tex
```

| Line | Rule | Why |
| --- | --- | --- |
| 17 | `spelling.typo` | `deliberatly` in the abstract. An abstract is prose. |
| 65 | `languagecheck.no-provider` | The `lang:fr` region has no engine behind it: Harper is English-only and LanguageTool is off in this config. The passage is reported as unchecked instead of passing silently. |
| 71 | `spelling.typo` | `deliberatly` in the conclusion. |

## What is deliberately not reported

| Where | Why |
| --- | --- |
| `\title{}` and `\author{}` | The whole preamble is skipped, so an author's name is not reported as a misspelling on every check. A title that needs checking belongs in the body. |
| `anser` inside `\begin{algorithm}` | `algorithm` is listed under `languages.latex.skip_environments` in `.languagecheck.yaml`. Drop it from that list and the word is reported. |
| `recieve` inside `\begin{lstlisting}` | `lstlisting` is in the built-in skip set; no config needed. |
| `\cite{}`, `\ref{}`, `\label{}`, `\url{}` arguments | Not prose. The sentences around them are, and are not split by them. |
| Display mathematics | `equation` is in the built-in skip set. Inline `$a^2 + b^2 = c^2$` is skipped without splitting its sentence. |
| `mispelling` on line 53 | The `lang-check-disable-next-line` above it. |
| `mispelling` on line 58 | Inside `lang-check-begin spelling.typo`, which silences spelling there and leaves every other rule running. |

## The French passage

LaTeX has no language declaration the extractor can read the way Typst's
`#set text(lang: …)` is read, so `lang-check-begin lang:fr` is how a quotation
in another language is marked. Turn LanguageTool on in `.languagecheck.yaml`
and that paragraph is checked in French — `fautte` is then reported — instead
of being reported as unchecked.
