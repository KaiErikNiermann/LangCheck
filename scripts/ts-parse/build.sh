#!/usr/bin/env bash
# Build one tree-sitter grammar as a standalone parse binary, isolated from
# the rest of rust-core, and print where it landed.
#
#   scripts/ts-parse/build.sh typst            # or tree-sitter-typst
#   scripts/ts-parse/build.sh --all
#   scripts/ts-parse/build.sh --list
#
# The binary links the grammar against the tree-sitter runtime that rust-core
# resolves in Cargo.lock (compiled from its crate's lib.c), not a system
# libtree-sitter, so a parse that misbehaves here misbehaves the same way in
# the extension. Grammars come from the vendored rust-core/tree-sitter-*
# directories or, for the crates.io ones, from the cargo registry.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
core="$root/rust-core"
out="$core/target/ts-parse"
driver="$root/scripts/ts-parse/driver.c"

# name -> "<crate>:<grammar dir inside the crate>", or "vendored" for the
# grammars that live in rust-core/tree-sitter-<name>.
declare -A grammars=(
    [bibtex]=vendored
    [forester]=vendored
    [org]=vendored
    [tinylang]=vendored
    [typst]=vendored
    [html]=tree-sitter-html:src
    [latex]=codebook-tree-sitter-latex:src
    [markdown]=tree-sitter-md:tree-sitter-markdown/src
    [markdown-inline]=tree-sitter-md:tree-sitter-markdown-inline/src
    [rst]=tree-sitter-rst:src
)

metadata=""
crate_dir() {
    if [[ -z "$metadata" ]]; then
        metadata="$(cd "$core" && cargo metadata --format-version 1)"
    fi
    local dir
    dir="$(jq -r --arg n "$1" \
        '[.packages[] | select(.name == $n)][0].manifest_path // empty' \
        <<<"$metadata")"
    if [[ -z "$dir" ]]; then
        echo "crate $1 is not in rust-core's dependency graph" >&2
        exit 2
    fi
    dirname "$dir"
}

build() {
    local name="${1#tree-sitter-}"
    local spec="${grammars[$name]:-}"
    if [[ -z "$spec" ]]; then
        echo "unknown grammar '$1'; known: $(printf '%s\n' "${!grammars[@]}" | sort | tr '\n' ' ')" >&2
        exit 2
    fi

    local src
    if [[ "$spec" == vendored ]]; then
        src="$core/tree-sitter-$name/src"
    else
        src="$(crate_dir "${spec%%:*}")/${spec#*:}"
    fi
    local runtime
    runtime="$(crate_dir tree-sitter)"

    local files=("$src/parser.c")
    [[ -f "$src/scanner.c" ]] && files+=("$src/scanner.c")

    mkdir -p "$out"
    local bin="$out/tree-sitter-$name"
    "${CC:-cc}" -O2 -g -std=c11 -w \
        -D_DEFAULT_SOURCE \
        -DTS_LANGUAGE_FN="tree_sitter_${name//-/_}" \
        -I "$src" -I "$runtime/include" -I "$runtime/src" \
        "$driver" "${files[@]}" "$runtime/src/lib.c" \
        -o "$bin"
    echo "$bin"
}

case "${1:-}" in
    "" | -h | --help)
        sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
        ;;
    --list)
        printf '%s\n' "${!grammars[@]}" | sort
        ;;
    --all)
        # Resolve the registry paths once, before the builds fork.
        crate_dir tree-sitter >/dev/null
        pids=()
        for name in $(printf '%s\n' "${!grammars[@]}" | sort); do
            build "$name" &
            pids+=("$!")
        done
        status=0
        for pid in "${pids[@]}"; do
            wait "$pid" || status=1
        done
        exit "$status"
        ;;
    *)
        build "$1"
        ;;
esac
