#!/usr/bin/env bash
# Verify that all l10n translation files have the same keys as their English base.
# Exits non-zero if any translation file is missing keys or has extra keys.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/extension"

errors=0

# A file that does not parse has no keys, so every key-set comparison below trivially passes.
# `bundle.l10n.de.json` sat broken for exactly that reason: a German closing quote written as an
# ASCII `"` ended the JSON string, jq failed, the `2>/dev/null || true` swallowed it, and the gate
# reported "in sync" about a file VS Code could not load at all. Parse first, and say so.
check_parses() {
    local f="$1"
    if ! jq -e . "$f" >/dev/null 2>&1; then
        echo "ERROR: $f is not valid JSON:"
        jq . "$f" 2>&1 | sed 's/^/  /' | head -3
        errors=1
        return 1
    fi
}

check_pair() {
    local base="$1" translation="$2"

    check_parses "$base" || return 0
    check_parses "$translation" || return 0

    missing=$(jq -r --argjson base "$(jq -S 'keys' "$base")" 'keys | . as $t | $base - $t | .[]' "$translation")
    extra=$(jq -r --argjson base "$(jq -S 'keys' "$base")" 'keys | . as $t | $t - $base | .[]' "$translation")

    if [[ -n "$missing" ]]; then
        echo "ERROR: $translation is missing keys:"
        echo "$missing" | sed 's/^/  - /'
        errors=1
    fi
    if [[ -n "$extra" ]]; then
        echo "WARNING: $translation has extra keys (not in base):"
        echo "$extra" | sed 's/^/  - /'
        errors=1
    fi
}

echo "Checking package.nls translations..."
for f in package.nls.*.json; do
    [[ -f "$f" ]] || continue
    check_pair "package.nls.json" "$f"
done

echo "Checking bundle.l10n translations..."
for f in l10n/bundle.l10n.*.json; do
    [[ -f "$f" ]] || continue
    # Skip the base file (bundle.l10n.json has no locale suffix with a dot before json)
    [[ "$f" == "l10n/bundle.l10n.json" ]] && continue
    check_pair "l10n/bundle.l10n.json" "$f"
done

if (( errors )); then
    echo ""
    echo "L10n key check failed. Fix the files above to match their base."
    exit 1
else
    echo "All l10n files are in sync."
fi
