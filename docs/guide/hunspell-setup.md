# Hunspell Setup

Harper reads English. LanguageTool reads about forty languages. Hunspell fills
what is left — Hebrew, Latin, Welsh, Old English, and a long tail besides —
using the dictionary format that LibreOffice, Firefox and every desktop spell
checker already use.

It checks spelling and nothing else. There are no grammar rules here, so a
language served by Hunspell alone gets a narrower check than one LanguageTool
supports. Where both are available, prefer LanguageTool.

## Why dictionaries are not bundled

Language Check ships no dictionaries and cannot. Hspell, which supplies Hebrew,
is AGPL-3.0; the Latin dictionary is GPL. Neither belongs inside an MIT binary
published to crates.io and the VS Code Marketplace.

They are installed separately instead, into your own data directory, under
their own licenses — the same arrangement VS Code, Firefox and LibreOffice use
for the same reason. The installer states a dictionary's license and where its
words came from before fetching anything.

## Enabling it

```yaml
engines:
  hunspell:
    enabled: true
    languages: ["he"]
```

`languages` names the tags Hunspell answers for. Naming them is what keeps this
engine to the gaps: leave English out and Harper keeps it. An empty list means
"any language with a pack behind it", which is the discovery mode rather than
the tidy one.

## Getting a dictionary

### In the editor

Open a document declaring a language none of the enabled engines read and the
extension offers to install it. Decline and it will not ask again — the offer stays
available as a quick fix on the squiggle, under the lightbulb.

### From the command line

```bash
language-check packs available        # what can be fetched, with its license
language-check packs install he       # fetch and verify one
language-check packs list             # what is installed, and where it was found
language-check packs verify he        # check an installed pack without touching it
```

### From your package manager

A pack you already have is found without downloading a second copy. On Arch:

```bash
sudo pacman -S hunspell-he
```

Debian, Fedora, and Homebrew carry the same dictionaries under similar names.

### By hand

Any `.aff`/`.dic` pair works. Point at it and Language Check uses that one in
preference to everything else:

```yaml
engines:
  hunspell:
    enabled: true
    languages: ["la"]
    dictionary_paths:
      la: /opt/dictionaries/latin
```

The value may be a directory, an `.aff`/`.dic` stem, or either file of the
pair. This is how to use a language with no published download — Latin, for
instance, ships only as a LibreOffice `.oxt` archive, so unpack it and name the
directory here.

## Where packs are looked for

In order, first match winning:

1. `dictionary_paths`, for the language in question
2. `search_paths`, in the order given
3. the directory `language-check packs install` writes to
4. the platform's own: `/usr/share/hunspell`, `/usr/share/myspell`,
   `~/.local/share/hunspell` on Linux; `~/Library/Spelling` and
   `/Library/Spelling` on macOS

A tag resolves to the pack it is actually shipped as, so `he` finds `he_IL`.
Where several regional packs could serve one bare tag, the choice is sorted
rather than whatever the directory yields, so it is the same on every machine.

`language-check packs list` prints each pack and the directory it was found
in.

## Settings

| Field              | Type                | Default | Description                                                     |
|--------------------|---------------------|---------|-----------------------------------------------------------------|
| `enabled`          | `bool`              | `false` | Enable the engine                                                |
| `languages`        | `string[]`          | `[]`    | BCP-47 tags to check; empty means any language with a pack       |
| `dictionary_paths` | `map<string,string>`| `{}`    | Per-language override: a directory, a stem, or either file       |
| `search_paths`     | `string[]`          | `[]`    | Extra directories, searched before the platform's own            |
| `auto_install`     | `bool`              | `false` | Fetch a missing pack without asking                              |

`auto_install` is off because a dictionary is a third-party download under its
own license, and that is a decision to put to you rather than make for you.

## What can go wrong

Every failure names the file and the reason, in the editor rather than only in
a log.

**No pack for a language.** The passage is reported as unchecked instead of
passing as clean, and the editor offers to install one where a download exists.

**A pack that will not load.** Real dictionaries carry real defects: the 2013
Latin pack has two lines reading `SFK` where `SFX` belongs, so its affix header
promises 129 rows and the parser finds 2. Hunspell skips a line it does not
recognize; the stricter parser here does not, which is why a pack can work in
LibreOffice and fail here. `language-check packs verify <lang>` says which file
and which line.

**A download that does not match.** Every fetchable pack is pinned to a
SHA-256 and a byte count. A download differing in either is discarded before it
reaches the parser or your disk. An upstream update and a tampered mirror look
identical over the wire, so both stop and say so rather than trusting what
arrived — if a pack you expect starts refusing to install, that is what it
means.

**No room.** Free space is checked before fetching. Hspell's Hebrew is about
8 MB.

## Verifying it works

```bash
cat > he.md <<'EOF'
<!-- lang-check-begin lang:he -->
שלום שלוםם
<!-- lang-check-end -->
EOF

language-check check he.md --lang markdown
```

The second word doubles its final letter and is not a word. A pack that is
installed and working reports it, with suggestions:

```
[2:6] spelling.typo: "שלוםם" is not in the he_IL dictionary (hunspell.spelling)
    Suggestions: שלומם, שלום, שלוום, שלועם, ...
```

A pack that is missing reports the passage as unchecked instead:

```
[2:1] languagecheck.no-provider: No enabled engine reads "he", so this passage went unchecked.
```

## See also

- [Language Support](languages.md) — how a document declares its languages
- [Directives](../reference/directives.md) — `lang-check-begin lang:xx`
- [Configuration](configuration.md) — the rest of the config file
