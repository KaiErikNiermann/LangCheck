# What a check of `overlap.typ` reports

Measured with Harper and LanguageTool 6.7. Hunspell was enabled in the config
but had no `en_US` dictionary on the machine that produced this, so the rows
below are what two engines report; the README says how to install the third.

```sh
docker compose up -d          # from the repository root
language-check check overlap.typ
```

## One entry per word, not one per engine

Both engines find every misspelling in the dense paragraph, at the same span
and under the same unified id, so each arrives as a single diagnostic.

| Line | Word | Reported as |
| --- | --- | --- |
| 15 | `deliberatly` | `spelling.typo` |
| 18 | `recieve`, `acknowlege`, `seperate` | `spelling.typo` |
| 19 | `committe`, `occurence`, `definately` | `spelling.typo` |
| 20 | `maintenence`, `independant` | `spelling.typo` |
| 30 | `reciept`, `recieved`, `beleif`, `releived`, `commitee` | `spelling.typo` |
| 31 | `reconcieved`, `questionaire`, `millenium` | `spelling.typo` |

The surviving message and rule id are the first engine's, which is Harper --
engines answer in registration order and the merge keeps the earliest for
stability. The suggestions are every engine's, interleaved.

`releived` on line 30 is the one to look at: it comes back with nine
suggestions, which is where the caps matter. The inlay hint shows the first.
The SpeedFix panel shows what it can offer a number key for and says how many
more there are. The quick fix menu has the roster.

## Where the merge does not fire

| Line | What appears | Why |
| --- | --- | --- |
| 40 | Two diagnostics on `well-recieved` | Harper spans `recieved` and suggests `received`; LanguageTool spans the whole hyphenated `well-recieved` and suggests `well-received`. Merging is byte-exact, so two near-miss spans stay two. |
| 41 | Two diagnostics on `co-authers` | Same cause. |

Both are reported at the same severity, because severity comes from the rule
category and not from the engine that noticed it. Before that was true, one of
each pair was an error and the other a warning, and the two squiggles were
different colours -- which read as if the colour meant which checker found it.

## Style and grammar, which only one engine reads

| Line | Rule | Why |
| --- | --- | --- |
| 7 | `style.general` (Harper) | `config` where `configuration` is meant, and a missing Oxford comma. |
| 45 | `style.word_choice` (Harper) | `word list` as a closed compound. |
| 60 | `style.general` (Harper) | Another Oxford comma. |

Hunspell contributes nothing here even when installed: it is a word list and
an affix table, so it answers spelling questions and no others. Nothing on
these lines has anything to merge with.

## What is deliberately not reported

| Where | Why |
| --- | --- |
| `recieve seperate definately` inside `#raw(…)` | A raw block is never prose. |
| `$ integral_0^1 x^2 dif x = 1/3 $` | Mathematics is skipped. |
| `https://example.org/recieve` | A URL is not prose. The link's label is, and is checked. |
