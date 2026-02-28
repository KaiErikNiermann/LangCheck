#!/usr/bin/env bash
# Check that no Rust source file exceeds the line count threshold.
# Usage: scripts/check-file-length.sh [max_lines]
set -euo pipefail

MAX_LINES="${1:-600}"
FOUND=0

while IFS= read -r file; do
    lines=$(wc -l < "$file")
    if [ "$lines" -gt "$MAX_LINES" ]; then
        echo "WARN: $file has $lines lines (max $MAX_LINES)"
        FOUND=1
    fi
done < <(find rust-core/src -name '*.rs' -type f)

if [ "$FOUND" -eq 1 ]; then
    echo ""
    echo "Files above the $MAX_LINES line threshold detected."
    echo "Consider splitting large files into smaller modules."
    exit 1
fi

echo "All source files are within the $MAX_LINES line limit."
