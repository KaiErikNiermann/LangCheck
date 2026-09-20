# Three checkers on one word

Harper, LanguageTool and Hunspell all read English, so with all three enabled
every misspelling in `overlap.typ` is found three times, at the same byte
range, under the same unified rule id. This directory is where that case is
written down: what the editor shows, and why it shows one entry rather than
three.

## Before running it

Hunspell needs a dictionary on disk. English has no pinned pack -- Harper
already covers English, so the catalogue does not carry one -- which means the
system dictionary is what this example uses:

```sh
sudo pacman -S hunspell-en_us      # Arch
sudo apt install hunspell-en-us    # Debian, Ubuntu
brew install hunspell              # macOS, then fetch a dictionary into
                                   # ~/Library/Spelling
```

Confirm it was found:

```sh
language-check packs list          # prints the path it resolved
```

A dictionary that covers only part of the language is worse than none: a
speller has no notion of a benign word, so anything outside its word list is
reported as a miss, and a partial dictionary underlines most of the document.
If a check of this file lights up ordinary words, that is what happened --
`packs list` names the file actually in use.

LanguageTool runs over HTTP:

```sh
docker compose up -d               # from the repository root
```

Then, from this directory:

```sh
language-check check overlap.typ
```

## What to look at

`expected.md` has the measured output. The three things it is here to show:

- **One diagnostic per word, not three.** The orchestrator merges diagnostics
  sharing a span and a rule id, keeps the highest severity of the group, and
  merges the suggestions.
- **Suggestions interleaved by engine.** The merged list is round-robin,
  best-first: LanguageTool's top pick, then Hunspell's, then Harper's, then
  each engine's second. A plain concatenation would bury every other engine's
  best guess under LanguageTool's tail, which for one misspelling can run to
  dozens of entries.
- **Where the engines disagree about the span.** Hunspell trims a token to its
  alphabetic edges and joins an internal apostrophe or hyphen. Matching is
  byte-exact, so a hyphenated misspelling can still produce more than one
  squiggle.
