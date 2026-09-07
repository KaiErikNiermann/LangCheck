#!/usr/bin/env python3
"""Diff two `language-check check --format json` runs.

The point of a morphology change is that squiggles *disappear*, and the only way to
know whether the ones that disappeared deserved to is to read them. So this prints the
set difference rather than a summary: every diagnostic present in the baseline and
absent afterwards, with the token it sat on.

    language-check check --lang forester --format json TREES > before.json
    #   ... switch branches, rebuild ...
    language-check check --lang forester --format json TREES > after.json
    scripts/morphology-ab.py before.json after.json

Exit status is 0 whatever it finds; this is a measuring instrument, not a gate.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

# The CLI writes one array for the whole run, so a diagnostic is identified by where it
# sits rather than by any id of its own.
Key = tuple[str, int, int, str]


@dataclass(frozen=True)
class Diagnostic:
    file: str
    line: int
    column: int
    unified_id: str
    message: str

    @property
    def key(self) -> Key:
        return (self.file, self.line, self.column, self.unified_id)


def load(path: Path) -> list[Diagnostic]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [
        Diagnostic(
            file=entry["file"],
            line=entry["line"],
            column=entry["column"],
            unified_id=entry["unified_id"],
            message=entry["message"],
        )
        for entry in payload
    ]


def token_at(diagnostic: Diagnostic) -> str:
    """The word the diagnostic sits on, read back out of the source file.

    The JSON carries a position but not a span, so the token is recovered by reading
    forward from the column to the first non-word character. Returns `?` when the file
    has moved or changed since the run.
    """
    try:
        line = (
            Path(diagnostic.file)
            .read_text(encoding="utf-8")
            .splitlines()[diagnostic.line - 1]
        )
    except (OSError, IndexError):
        return "?"
    rest = line[diagnostic.column - 1 :]
    word = "".join(c for c in _take_while_word(rest))
    return word or "?"


def _take_while_word(text: str) -> Iterator[str]:
    for char in text:
        if char.isalpha() or char in "-'":
            yield char
        else:
            return


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument(
        "--category",
        default="spelling.",
        help="unified_id prefix to compare (default: spelling.)",
    )
    parser.add_argument(
        "--limit", type=int, default=60, help="how many distinct tokens to list"
    )
    args = parser.parse_args()

    before = [d for d in load(args.before) if d.unified_id.startswith(args.category)]
    after = [d for d in load(args.after) if d.unified_id.startswith(args.category)]

    after_keys = {d.key for d in after}
    before_keys = {d.key for d in before}
    silenced = [d for d in before if d.key not in after_keys]
    appeared = [d for d in after if d.key not in before_keys]

    print(f"{args.category}* diagnostics: {len(before)} -> {len(after)}")
    if before:
        print(f"  silenced: {len(silenced)} ({100 * len(silenced) / len(before):.1f}%)")
    if appeared:
        print(
            f"  newly reported: {len(appeared)} — unexpected for a suppression change"
        )

    tokens = Counter(token_at(d) for d in silenced)
    print(
        f"\n{len(tokens)} distinct tokens silenced; top {min(args.limit, len(tokens))}:"
    )
    for token, count in tokens.most_common(args.limit):
        print(f"  {count:5d}  {token}")

    if appeared:
        print("\nnewly reported, which should be empty:")
        for diagnostic in appeared[: args.limit]:
            print(
                f"  {diagnostic.file}:{diagnostic.line}:{diagnostic.column} "
                f"{token_at(diagnostic)}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
