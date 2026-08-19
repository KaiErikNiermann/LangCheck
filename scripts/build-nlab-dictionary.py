#!/usr/bin/env python3
"""Build the mathematics dictionary word list for lang-check.

Harvests vocabulary from nLab wiki page titles, subtracts everything a spell
checker already knows, and emits a sorted, deduplicated, lowercase word list to
`rust-core/dictionaries/bundled/mathematics.txt`, which is embedded in the binary
by `include_str!` (see `rust-core/src/dictionary.rs`).

Stdlib only, on purpose: this has to run on a bare checkout in CI or on a
contributor's machine, and the repo has no Python toolchain otherwise (`scripts/`
is shell, Python appears only in `docs/conf.py`).

Sources:
  * ncatlab/nlab-content         - no formal license; the nLab grants free use and
                                   redistribution in exchange for acknowledgement.
                                   See rust-core/dictionaries/THIRD_PARTY_NOTICES.md
  * dwyl/english-words           - The Unlicense, used only to *subtract* entries
  * crate-ci/typos (words.csv)   - Apache-2.0, used only to *subtract* entries

Why only page names, never redirects: nLab pages carry `[[!redirects ...]]`
aliases, and those aliases deliberately include *misspellings* so that stale links
keep resolving. `alebraic`, `cohomlogy`, `sentensial`, `automorpism`, `basises` and
`algebraicly` all appear as redirects — `basises` eleven times — while appearing in
zero page titles. No frequency threshold separates them, so harvesting redirects
would ship all six as accepted spellings and silently swallow real typos. Page
titles are curated; redirects are not. Only titles are read.

Titles are split on every non-letter, so `Chern-Simons` contributes `chern` and
`simons` rather than the compound. The compound form is reconstructed at lookup
time by `Dictionary::contains`, which retries a hyphenated span part by part —
engines disagree about whether `Chern-Simons` is one token or two, and only the
lookup side can be correct for both.

Usage:
    scripts/build-nlab-dictionary.py [--cache-dir DIR] [--out FILE]
"""

from __future__ import annotations

import argparse
import collections
import csv
import re
import subprocess
import sys
import unicodedata
import urllib.request
from pathlib import Path
from typing import Iterable, NamedTuple

USER_AGENT = "langcheck-nlab-dictionary/1.0 (+https://github.com/KaiErikNiermann/LangCheck)"

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = REPO_ROOT / ".cache" / "nlab-dictionary"
DEFAULT_OUT = REPO_ROOT / "rust-core" / "dictionaries" / "bundled" / "mathematics.txt"
BUNDLED_DIR = REPO_ROOT / "rust-core" / "dictionaries" / "bundled"

NLAB_REPO = "https://github.com/ncatlab/nlab-content.git"

# Page titles live one per directory alongside the body; `category: people` marks
# the ~6k contributor pages, whose vocabulary belongs to the name gazetteer.
PEOPLE_PATTERN = re.compile(r"^\s*category:\s*people\s*$", re.MULTILINE | re.IGNORECASE)
POSSESSIVE_PATTERN = re.compile(r"['’]s\b")
TOKEN_PATTERN = re.compile(r"[^\W\d_]+", re.UNICODE)
COMPOUND_PATTERN = re.compile(r"[^\W\d_]+(?:[-\u2010\u2011][^\W\d_]+)+", re.UNICODE)

# Titles use ` -- ` to disambiguate sibling pages ("String field theory -- history").
# Everything after it is administrative, not vocabulary.
QUALIFIER_SEPARATOR = "--"

# Above this codepoint we are out of Latin-1/Latin-Extended and into scripts the
# checker will not be spelling anyway (`александров`, `pinᶜ`, `spinʰ`).
MAX_CODEPOINT = 0x250

# A three-letter entry has to earn its place; the one-off tail is noise (`dic`,
# `und`, `frm`, `xxe`) while the recurring ones are real (`cft`, `qcd`, `wzw`).
SHORT_TOKEN_LENGTH = 3
SHORT_TOKEN_MIN_FREQUENCY = 2
MIN_LENGTH = 3

# A token the typos database calls a misspelling is dropped -- unless the nLab uses
# it this often in curated titles, which no typo survives. `brane` (88) and `operad`
# (59) are real; `geoemtric` and `banch` are not.
TYPO_RESCUE_FREQUENCY = 3


class Source(NamedTuple):
    name: str
    url: str
    kind: str  # "english" or "typos"


SOURCES: tuple[Source, ...] = (
    Source(
        "english-words",
        "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt",
        "english",
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


def clone_nlab(cache_dir: Path) -> Path:
    """Mirror the nLab content repo into `cache_dir`, reusing an existing clone.

    Unlike the other sources this is a git clone rather than a single download:
    the corpus is 20,728 pages in as many directories, and there is no archive
    endpoint that yields just the titles. `--filter=blob:limit=1k` is what keeps
    it cheap -- the `name` files are a few dozen bytes each and come down, while
    most `content.md` bodies are left on the server.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    checkout = cache_dir / "nlab-content"
    if (checkout / "pages").is_dir():
        print(f"  cached  nlab-content ({checkout})")
        return checkout

    print(f"  clone   nlab-content ...", end="", flush=True)
    subprocess.run(
        [
            "git", "clone", "--quiet", "--depth", "1",
            "--filter=blob:limit=1k", NLAB_REPO, str(checkout),
        ],
        check=True,
    )
    print(" done")
    return checkout


def read_lines(path: Path) -> Iterable[str]:
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped:
                yield stripped


def read_typos(path: Path) -> tuple[set[str], set[str]]:
    """Split typos' words.csv into misspellings and correct English words.

    Column 0 is the misspelling; the remaining columns are accepted corrections.
    Both are subtracted from the dictionary, for different reasons — see `build`.
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


def read_bundled_words(bundled_dir: Path, exclude: Path) -> set[str]:
    """Every word already shipped by a sibling bundled dictionary.

    Entries here would be pure duplication: `load_bundled` unions all the lists
    into one set, so a second copy can never change an answer.
    """
    words: set[str] = set()
    for path in sorted(bundled_dir.glob("*.txt")):
        if path == exclude:
            continue
        for line in read_lines(path):
            if not line.startswith("#"):
                # cspell wordlists use `*Glob*` markers around compound stems.
                words.add(line.strip("*").lower())
    return words


def normalise(token: str) -> str:
    """Lowercase and NFC-normalise so lookups are stable across input encodings."""
    return unicodedata.normalize("NFC", token).lower()


def page_title_frequencies(
    checkout: Path,
) -> tuple[collections.Counter[str], set[str], int, int]:
    """Count how often each token appears across non-people nLab page titles.

    Also returns the tokens that occur as part of a hyphenated compound, which
    are treated differently by `build` — see the re-admission step there.
    """
    frequencies: collections.Counter[str] = collections.Counter()
    compound_parts: set[str] = set()
    pages = skipped = 0
    for name_path in checkout.glob("pages/**/name"):
        body_path = name_path.with_name("content.md")
        body = (
            body_path.read_text(encoding="utf-8", errors="replace")
            if body_path.exists()
            else ""
        )
        if PEOPLE_PATTERN.search(body):
            skipped += 1
            continue
        pages += 1
        title = name_path.read_text(encoding="utf-8", errors="replace").strip()
        title = title.split(QUALIFIER_SEPARATOR)[0]
        title = POSSESSIVE_PATTERN.sub("", normalise(title))
        frequencies.update(TOKEN_PATTERN.findall(title))
        for compound in COMPOUND_PATTERN.findall(title):
            compound_parts.update(TOKEN_PATTERN.findall(compound))
    return frequencies, compound_parts, pages, skipped


def is_plausible_term(token: str, frequency: int) -> bool:
    """Reject entries that cannot safely be shipped as accepted spellings."""
    if len(token) < MIN_LENGTH:
        return False
    if len(token) == SHORT_TOKEN_LENGTH and frequency < SHORT_TOKEN_MIN_FREQUENCY:
        return False
    return all(ord(character) < MAX_CODEPOINT for character in token)


def build(cache_dir: Path, out_path: Path) -> int:
    print("Fetching sources:")
    checkout = clone_nlab(cache_dir)
    paths = {source.name: fetch(source, cache_dir) for source in SOURCES}

    misspellings, _corrections = read_typos(paths["typos-dict"])
    english_words = {normalise(word) for word in read_lines(paths["english-words"])}
    already_bundled = read_bundled_words(BUNDLED_DIR, exclude=out_path)
    print(
        f"\nLoaded {len(english_words):,} English words, {len(misspellings):,} "
        f"misspellings and {len(already_bundled):,} already-bundled words "
        "for subtraction."
    )

    frequencies, compound_parts, pages, people = page_title_frequencies(checkout)
    print(f"\nRead {pages:,} page titles ({people:,} people pages skipped)")
    print(f"Raw tokens: {len(frequencies):,}")

    shaped = {token for token, count in frequencies.items() if is_plausible_term(token, count)}
    print(f"  after shape/length filter    : {len(shaped):,} (-{len(frequencies) - len(shaped):,})")

    # A misspelling shipped as an accepted spelling silently hides a real typo, but
    # the typos database also lists `brane` (as `brain`) and `yau` (as `you`). A word
    # the nLab uses this often in curated titles is domain vocabulary, not a slip.
    collisions = {token for token in shaped
                  if token in misspellings and frequencies[token] < TYPO_RESCUE_FREQUENCY}
    rescued = {token for token in shaped
               if token in misspellings and frequencies[token] >= TYPO_RESCUE_FREQUENCY}
    after_typos = shaped - collisions
    print(f"  after misspelling subtraction: {len(after_typos):,} (-{len(collisions):,})")
    if collisions:
        print(f"    e.g. {', '.join(sorted(collisions)[:12])} ...")
    if rescued:
        print(f"    kept on frequency: {', '.join(sorted(rescued))}")

    # An ordinary English word is dead weight: the checker never flags it, so the
    # entry can never help, while it can still fire on a misspelling that coincides.
    after_english = after_typos - english_words
    print(f"  after English-word subtraction: {len(after_english):,} "
          f"(-{len(after_typos) - len(after_english):,})")

    # `Dictionary::contains` reconstructs a hyphenated compound only when *every*
    # part is present, so dropping `mills` as ordinary English would leave
    # `Yang-Mills` unmatched whenever an engine reports the whole span. Re-admit
    # the English words that occur inside a harvested compound — and only those.
    # They are inert on their own (no checker flags `mills`), so the usual
    # objection to shipping common words does not apply.
    readmitted = {token for token in compound_parts & english_words
                  if is_plausible_term(token, frequencies[token])
                  and token not in misspellings}
    after_english |= readmitted
    print(f"  re-admitted as compound parts : {len(after_english):,} (+{len(readmitted):,})")

    final = after_english - already_bundled
    print(f"  after already-bundled subtraction: {len(final):,} "
          f"(-{len(after_english) - len(final):,})")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(final)
    tmp = out_path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for token in ordered:
            handle.write(token)
            handle.write("\n")
    tmp.replace(out_path)

    size = out_path.stat().st_size
    print(f"\nWrote {len(ordered):,} terms to {out_path} ({size:,} bytes)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the mathematics dictionary word list for lang-check."
    )
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    return build(args.cache_dir, args.out)


if __name__ == "__main__":
    sys.exit(main())
