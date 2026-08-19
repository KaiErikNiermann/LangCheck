#!/usr/bin/env bash
# Pattern lint: are we REUSING the helpers we already have, and holding the conventions
# clippy and eslint cannot see?
#
# Deliberately NOT part of `just check`. This is advisory while the finding count comes down;
# promote it to a hard gate once it is quiet. The gate's job is "is this correct"; this one's job
# is "is this the second copy of something we already wrote".
#
# It complements the existing linters rather than overlapping them. clippy runs with `pedantic` +
# `nursery` and eslint carries sonarjs/unicorn/security — anything either already catches is
# absent from `.semgrep/` on purpose. What is left is repo knowledge: that `text_util::safe_slice`
# owns char-boundary snapping, that engine byte offsets are untrusted, that user-visible strings
# are localized into de/es/fr, that stdout belongs to the JSON-RPC framing.
#
# semgrep runs via `uvx` at a pinned version, not as a project dependency. This repo has no Python
# toolchain to host it (`scripts/` is bash plus two stdlib-only build scripts), and pinning keeps a
# registry-rule change from turning into a surprise CI failure.
set -uo pipefail
cd "$(dirname "$0")/.."

SEMGREP_VERSION=1.172.0

# --jobs is LOAD-BEARING, not a performance knob.
#
# semgrep-core runs a parallel executor pool with one io_uring per domain, and each ring needs
# locked memory. This host has 24 cores against `ulimit -l` of 8192 BYTES, so an unbounded run asks
# for ~24 rings, the kernel refuses with `Cannot allocate memory io_uring_queue_init`, and
# semgrep-core dies — after which semgrep exits reporting ZERO findings. A crash that renders as a
# clean scan is the worst possible failure for a linter, and it presents as flakiness: the same
# pack passes and fails on consecutive runs depending on what else is holding rings. An uncapped
# run completing once is not evidence that it is safe.
#
# Default 1, not 4. On this host 4 was OBSERVED failing: `p/python`, `r/yaml`, `p/github-actions`
# and `p/secrets` all died in one run while the same command had completed minutes earlier, which
# is the flakiness described above. Serial is a few minutes slower and always right. Raise it with
# PATTERNS_JOBS if `ulimit -l` is raised too — the check below will tell you when it was too high,
# rather than reporting a clean scan.
JOBS="${PATTERNS_JOBS:-1}"

RUST_TARGETS=(rust-core/src rust-core/benches rust-core/examples rust-core/tests)
TS_TARGETS=(extension/src)
SH_TARGETS=(scripts)
PY_TARGETS=(scripts)
# Non-workflow YAML only. `r/yaml` carries the github-actions rules too, so pointing it at
# .github/workflows would duplicate everything `p/github-actions` already reports there.
YAML_TARGETS=(rust-core/data)

rc=0
unknown=0

# Upstream rules TRIAGED and turned off, with the finding that earned each exclusion. Every one was
# checked against the real code, not waved away — the point of writing the reason down is that a
# future reader can re-open the decision instead of re-deriving it.
#
#   unsafe-usage (7)     — 5 are `LanguageFn::from_raw(tree_sitter_*)` grammar bindings, which have
#       no safe form; the tree-sitter C ABI is why the crate exists. The other 2 are
#       `prose/mod.rs` and `prose/sweave.rs` calling `str::as_bytes_mut` to blank exclusion ranges,
#       each carrying a SAFETY comment stating the invariant (whole char-aligned ranges overwritten
#       with ASCII 0x20, so UTF-8 validity is preserved).
#   temp-dir (16)        — every hit is inside `#[cfg(test)]`. The rule's threat model is a symlink
#       attack on a predictable path; these are test fixtures under distinct fixed names
#       (`lang_check_test_dict`, `lang_check_ws_*`), created and torn down in-process. Worth
#       revisiting only if two concurrent `cargo test` runs on one host ever collide — the names
#       are distinct, so within a run they cannot.
#   args (2)             — `std::env::args()` in a CLI binary and in an example. That is the point
#       of a CLI binary.
#   mutable-action-tag (64) and third-party-action-not-pinned-to-commit-sha (20) — two rule ids
#       for one concern: the workflows pin major tags (`actions/checkout@v7`) and dependabot is
#       configured to bump them; both rules want full SHAs. Switching would fight the tool that
#       currently keeps them current, and 84 findings nobody intends to act on is exactly the
#       noise that trains people to skim a linter. Excluding only the first was not enough —
#       `r/yaml` re-reports the same workflows under the second id.
EXCLUDED_RULES=(
  rust.lang.security.unsafe-usage.unsafe-usage
  rust.lang.security.temp-dir.temp-dir
  rust.lang.security.args.args
  yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag
  yaml.github-actions.security.audit.third-party-action-not-pinned-to-commit-sha.third-party-action-not-pinned-to-commit-sha
)
EXCLUDE_ARGS=()
for _r in "${EXCLUDED_RULES[@]}"; do EXCLUDE_ARGS+=(--exclude-rule "$_r"); done

# Generated code is not ours to lint. `extension/src/proto/` is emitted by pbjs on every build.
EXCLUDE_PATHS=(--exclude 'proto' --exclude 'node_modules' --exclude 'target' --exclude '*.min.js')

# Every invocation is checked for the crash signature and reported as UNKNOWN, never as a pass.
# "We did not find out" is not "it is fine".
run_semgrep() {
  local label="$1" cfg="$2"; shift 2
  [ "$#" -eq 0 ] && return 0
  local out prc
  out="$(uvx --quiet "semgrep@${SEMGREP_VERSION}" scan \
           --metrics=off --jobs "$JOBS" --config "$cfg" \
           "${EXCLUDE_ARGS[@]}" "${EXCLUDE_PATHS[@]}" --error "$@" 2>&1)"
  prc=$?
  if grep -qE "Cannot allocate memory|error occurred while invoking the Semgrep engine" <<<"$out"; then
    echo "  ?? ${label}: engine could not run — result UNKNOWN, not clean (try PATTERNS_JOBS=1)"
    unknown=$((unknown + 1))
    return 0
  fi
  # A pack that does not exist 404s and then reports zero findings, which is indistinguishable
  # from a clean scan unless you look. `p/bash` and `p/yaml` are not registry ids — the real ones
  # are `r/bash` and `r/yaml` — and the wrong names sat here silently covering nothing.
  if grep -qE "HTTP 404|invalid configuration file found|Failed to download configuration" <<<"$out"; then
    echo "  ?? ${label}: config did not resolve — result UNKNOWN, not clean (check the registry id)"
    unknown=$((unknown + 1))
    return 0
  fi
  if [ "$prc" -ne 0 ]; then
    printf '%s\n' "$out"
    rc=1
  fi
}

if [ "$#" -gt 0 ]; then
  # Explicit targets (editor hook, pre-push on a subset): local rules only, no registry round-trip.
  echo "▶ local rules (.semgrep/) on $*"
  run_semgrep "local" .semgrep/ "$@"
  exit "$rc"
fi

echo "▶ local rules (.semgrep/)"
run_semgrep "local" .semgrep/ "${RUST_TARGETS[@]}" "${TS_TARGETS[@]}"

# Upstream packs from semgrep/semgrep-rules, referenced by registry id rather than vendored — they
# stay current, and there is no license question about carrying someone else's rules in-tree.
# Requires network; skip with PATTERNS_NO_REGISTRY=1.
#
# Chosen against what this repo ACTUALLY contains: a Rust core, a TypeScript VS Code extension,
# bash scripts, two stdlib-only Python build scripts, and GitHub Actions workflows. Packs for
# frameworks this repo does not use (django, flask, react, express, terraform, docker) are not run.
if [ "${PATTERNS_NO_REGISTRY:-0}" != "1" ]; then
  echo "▶ upstream packs (rust, typescript, bash, python, yaml, github-actions, secrets)"
  run_semgrep "p/rust"            p/rust            "${RUST_TARGETS[@]}"
  run_semgrep "p/typescript"      p/typescript      "${TS_TARGETS[@]}"
  run_semgrep "r/bash"            r/bash            "${SH_TARGETS[@]}"
  run_semgrep "p/python"          p/python          "${PY_TARGETS[@]}"
  run_semgrep "r/yaml"            r/yaml            "${YAML_TARGETS[@]}"
  run_semgrep "p/github-actions"  p/github-actions  .github/workflows
  run_semgrep "p/secrets"         p/secrets         "${RUST_TARGETS[@]}" "${TS_TARGETS[@]}" "${SH_TARGETS[@]}"
fi

[ "$unknown" -gt 0 ] && echo "  (${unknown} pack(s) did not complete — re-run, or PATTERNS_JOBS=1)"

if [ "$rc" -eq 0 ] && [ "$unknown" -eq 0 ]; then
  echo "✓ no pattern findings"
else
  cat <<'EOF'

Each finding is either a reuse opportunity or a false positive. Fix it, or suppress it AT THE LINE
with a reason:

    let s = &text[a..b];  // nosemgrep: unchecked-engine-offset-slice — offsets are tree-sitter's,
                          // which are always char-aligned

An unreasoned suppression is a hole; a reasoned one is a decision.
EOF
fi
exit "$rc"
