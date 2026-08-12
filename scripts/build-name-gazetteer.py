#!/usr/bin/env python3
"""Build the human-name gazetteer word list for lang-check.

Downloads open human-name datasets, prunes entries that would be dangerous to treat
as names, and emits a sorted, deduplicated, lowercase word list. The list is then
compiled to an FST by `cargo run --example build-name-fst`.

Stdlib only, on purpose: this has to run on a bare checkout in CI or on a
contributor's machine, and the repo has no Python toolchain otherwise (`scripts/`
is shell, Python appears only in `docs/conf.py`).

Sources (all permissively licensed, see rust-core/dictionaries/THIRD_PARTY_NOTICES.md):
  * smashew/NameDatabases        - The Unlicense (public domain dedication)
  * dominictarr/random-name      - MIT
  * crate-ci/typos (words.csv)   - Apache-2.0, used only to *subtract* entries

Why the subtraction matters: the crowdsourced name lists contain hundreds of
entries that are in fact common English misspellings (`thier`, `balck`, `alway`,
`autor`, `aray`). Shipping those as names would silently swallow real typos, which
is the exact failure mode this feature must avoid. They are removed at build time.

Usage:
    scripts/build-name-gazetteer.py [--cache-dir DIR] [--out FILE] [--min-length N]
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
import urllib.request
from pathlib import Path
from typing import Iterable, NamedTuple

USER_AGENT = "langcheck-name-gazetteer/1.0 (+https://github.com/KaiErikNiermann/LangCheck)"

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = REPO_ROOT / ".cache" / "name-gazetteer"
DEFAULT_OUT = REPO_ROOT / "rust-core" / "dictionaries" / "names" / "names.txt"


class Source(NamedTuple):
    name: str
    url: str
    kind: str  # "names" or "typos"


SOURCES: tuple[Source, ...] = (
    Source(
        "surnames-smashew",
        "https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/surnames/all.txt",
        "names",
    ),
    Source(
        "given-smashew",
        "https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/all.txt",
        "names",
    ),
    Source(
        "surnames-random-name",
        "https://raw.githubusercontent.com/dominictarr/random-name/master/names.txt",
        "names",
    ),
    Source(
        "given-random-name",
        "https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt",
        "names",
    ),
    Source(
        "typos-dict",
        "https://raw.githubusercontent.com/crate-ci/typos/master/crates/typos-dict/assets/words.csv",
        "typos",
    ),
)


def fetch(source: Source, cache_dir: Path) -> Path:
    """Download `source` into `cache_dir`, reusing an existing non-empty file."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{source.name}.txt"
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached  {source.name} ({dest.stat().st_size:,} bytes)")
        return dest

    print(f"  fetch   {source.name} ...", end="", flush=True)
    request = urllib.request.Request(source.url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
    # Write via a temp file so an interrupted run doesn't poison the cache.
    tmp = dest.with_suffix(".tmp")
    tmp.write_bytes(payload)
    tmp.replace(dest)
    print(f" {len(payload):,} bytes")
    return dest


def read_lines(path: Path) -> Iterable[str]:
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped:
                yield stripped


def read_typos(path: Path) -> tuple[set[str], set[str]]:
    """Split typos' words.csv into misspellings and correct English words.

    Column 0 is the misspelling; the remaining columns are accepted corrections.
    Both are subtracted from the gazetteer, for different reasons — see `build`.
    """
    misspellings: set[str] = set()
    corrections: set[str] = set()
    with path.open(encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.reader(handle):
            if not row or not row[0].strip():
                continue
            misspellings.add(row[0].strip().lower())
            for correction in row[1:]:
                cleaned = correction.strip().lower()
                if cleaned:
                    corrections.add(cleaned)
    return misspellings, corrections


def is_plausible_name(token: str, min_length: int) -> bool:
    """Reject entries that cannot safely be treated as a single name token.

    We only ever match one whitespace-delimited token, so multi-word entries are
    useless. Short entries are rejected because a two-letter "name" collides with
    far too much (`ab`, `ai`, `al` are all in the raw lists).
    """
    if len(token) < min_length:
        return False
    if any(character.isspace() for character in token):
        return False
    if any(character.isdigit() for character in token):
        return False
    # Letters, plus internal hyphen/apostrophe as in O'Brien or Sainte-Beuve.
    if not all(character.isalpha() or character in "'-’" for character in token):
        return False
    return token[0].isalpha() and token[-1].isalpha()


def normalise(token: str) -> str:
    """Lowercase and NFC-normalise so lookups are stable across input encodings."""
    return unicodedata.normalize("NFC", token).lower()


def build(cache_dir: Path, out_path: Path, min_length: int) -> int:
    print("Fetching sources:")
    paths = {source.name: fetch(source, cache_dir) for source in SOURCES}

    misspellings, english_words = read_typos(paths["typos-dict"])
    print(
        f"\nLoaded {len(misspellings):,} misspellings and {len(english_words):,} "
        "correct English words for subtraction."
    )

    raw: set[str] = set()
    for source in SOURCES:
        if source.kind != "names":
            continue
        before = len(raw)
        raw.update(normalise(token) for token in read_lines(paths[source.name]))
        print(f"  {source.name:<22} +{len(raw) - before:,} new (total {len(raw):,})")

    print(f"\nRaw union: {len(raw):,}")

    shaped = {token for token in raw if is_plausible_name(token, min_length)}
    print(f"  after shape/length filter : {len(shaped):,} (-{len(raw) - len(shaped):,})")

    # Misspellings masquerading as names would silently hide real typos.
    collisions = shaped & misspellings
    after_typos = shaped - misspellings
    print(f"  after misspelling subtraction: {len(after_typos):,} (-{len(collisions):,})")
    if collisions:
        print(f"    e.g. {', '.join(sorted(collisions)[:12])} ...")

    # Ordinary English words in the name list are dead weight and a liability: a spell
    # checker never flags them, so the entry can never help, but it can fire on a
    # misspelling that happens to coincide with it. `the` really is in the raw surname
    # data, and without this it reached the two-signal bar.
    word_collisions = after_typos & english_words
    final = after_typos - english_words
    print(f"  after English-word subtraction: {len(final):,} (-{len(word_collisions):,})")
    if word_collisions:
        print(f"    e.g. {', '.join(sorted(word_collisions)[:12])} ...")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # fst::SetBuilder requires strictly increasing byte order.
    ordered = sorted(final)
    tmp = out_path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for token in ordered:
            handle.write(token)
            handle.write("\n")
    tmp.replace(out_path)

    size = out_path.stat().st_size
    print(f"\nWrote {len(ordered):,} names to {out_path} ({size:,} bytes)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the human-name gazetteer word list for lang-check."
    )
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--min-length",
        type=int,
        default=3,
        help="reject names shorter than this (default: 3)",
    )
    args = parser.parse_args()
    return build(args.cache_dir, args.out, args.min_length)


if __name__ == "__main__":
    sys.exit(main())
