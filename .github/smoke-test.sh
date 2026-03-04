#!/usr/bin/env bash
# Post-release smoke tests for language-check CLI binaries.
# Verifies that released artifacts are not catastrophically broken.
#
# Usage: ./smoke-test.sh <path-to-language-check-binary> [expected-version]
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed

set -euo pipefail

BIN="$(realpath "${1:?Usage: smoke-test.sh <binary-path> [expected-version]}")"
EXPECTED_VERSION="${2:-}"
FIXTURES="$(cd "$(dirname "$0")/fixtures" && pwd)"

passed=0
failed=0

pass() { passed=$((passed + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { failed=$((failed + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }

run_test() {
    local name="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        pass "$name"
    else
        fail "$name"
    fi
}

# ---------- 1. Binary executes at all ----------

printf '\n%s\n' "=== Binary sanity ==="

run_test "binary is executable" test -x "$BIN"

version_output=$("$BIN" --version 2>&1) || true
if [[ -n "$version_output" ]]; then
    pass "--version produces output: $version_output"
else
    fail "--version produces no output"
fi

if [[ -n "$EXPECTED_VERSION" ]]; then
    if echo "$version_output" | grep -qF "$EXPECTED_VERSION"; then
        pass "--version contains expected version $EXPECTED_VERSION"
    else
        fail "--version output '$version_output' does not contain $EXPECTED_VERSION"
    fi
fi

# ---------- 2. Check command — Markdown with known errors ----------

printf '\n%s\n' "=== Check: Markdown ==="

md_output=$("$BIN" check "$FIXTURES/errors.md" 2>&1) || true
if echo "$md_output" | grep -q "indefinite article"; then
    pass "detects 'an test' article error in Markdown"
else
    fail "did not detect article error in Markdown"
fi

if echo "$md_output" | grep -qi "repeat"; then
    pass "detects 'the the' repetition in Markdown"
else
    fail "did not detect repetition in Markdown"
fi

# ---------- 3. Check command — LaTeX ----------

printf '\n%s\n' "=== Check: LaTeX ==="

tex_output=$("$BIN" check "$FIXTURES/errors.tex" 2>&1) || true
if echo "$tex_output" | grep -q "indefinite article"; then
    pass "detects article error in LaTeX"
else
    fail "did not detect article error in LaTeX"
fi

# ---------- 4. Check command — HTML ----------

printf '\n%s\n' "=== Check: HTML ==="

html_output=$("$BIN" check "$FIXTURES/errors.html" 2>&1) || true
if echo "$html_output" | grep -q "indefinite article"; then
    pass "detects article error in HTML"
else
    fail "did not detect article error in HTML"
fi

# ---------- 5. JSON output is valid ----------

printf '\n%s\n' "=== JSON output ==="

json_output=$("$BIN" check --format json "$FIXTURES/errors.md" 2>&1) || true
PYTHON="${PYTHON:-$(command -v python3 || command -v python || echo python3)}"
if echo "$json_output" | "$PYTHON" -m json.tool >/dev/null 2>&1; then
    pass "JSON output is valid"
else
    fail "JSON output is not valid JSON"
fi

if echo "$json_output" | grep -q '"rule_id"'; then
    pass "JSON contains rule_id field"
else
    fail "JSON missing rule_id field"
fi

# ---------- 6. Clean file produces no diagnostics ----------

printf '\n%s\n' "=== Clean file ==="

clean_output=$("$BIN" check "$FIXTURES/clean.md" 2>&1) || true
if echo "$clean_output" | grep -q "No issues found"; then
    pass "clean file reports no issues"
else
    fail "clean file unexpectedly reported issues"
fi

# ---------- 7. list-rules ----------

printf '\n%s\n' "=== list-rules ==="

rules_output=$("$BIN" list-rules 2>&1) || true
if echo "$rules_output" | grep -q "harper"; then
    pass "list-rules includes harper provider"
else
    fail "list-rules missing harper provider"
fi

if echo "$rules_output" | grep -q "UNIFIED ID"; then
    pass "list-rules has table header"
else
    fail "list-rules missing table header"
fi

# ---------- 8. config show ----------

printf '\n%s\n' "=== config show ==="

config_output=$("$BIN" config show 2>&1) || true
if echo "$config_output" | grep -q "harper: true"; then
    pass "config show includes default harper=true"
else
    fail "config show missing harper default"
fi

# ---------- 9. fix command ----------

printf '\n%s\n' "=== fix command ==="

fix_copy=$(mktemp)
cp "$FIXTURES/errors.md" "$fix_copy"
fix_output=$("$BIN" fix "$fix_copy" 2>&1) || true
if echo "$fix_output" | grep -qi "fix"; then
    pass "fix command produces output"
else
    fail "fix command produced no output"
fi

fixed_content=$(cat "$fix_copy")
if echo "$fixed_content" | grep -q "a test"; then
    pass "fix corrected 'an test' to 'a test'"
else
    fail "fix did not correct article error"
fi

rm -f "$fix_copy"

# ---------- 10. WASM plugin (if available) ----------

WASM_PLUGIN="${3:-}"
if [[ -n "$WASM_PLUGIN" && -f "$WASM_PLUGIN" ]]; then
    printf '\n%s\n' "=== WASM plugin ==="

    # Create a temp directory with config pointing to the plugin
    wasm_dir=$(mktemp -d)
    cp "$FIXTURES/wordy.md" "$wasm_dir/wordy.md"
    cat > "$wasm_dir/.languagecheck.yaml" <<YAML
engines:
  harper: false
  languagetool: false
  wasm_plugins:
    - name: wordiness-check
      path: $(realpath "$WASM_PLUGIN")
YAML

    wasm_output=$(cd "$wasm_dir" && "$BIN" check wordy.md 2>&1) || true

    if echo "$wasm_output" | grep -qi "wordy\|in order to"; then
        pass "WASM plugin detects wordy phrase"
    else
        fail "WASM plugin did not detect wordy phrase (output: $wasm_output)"
    fi

    wasm_json=$(cd "$wasm_dir" && "$BIN" check --format json wordy.md 2>&1) || true
    if echo "$wasm_json" | grep -q "wasm.wordiness-check"; then
        pass "WASM plugin rule_id has correct namespace"
    else
        fail "WASM plugin rule_id missing namespace (output: $wasm_json)"
    fi

    rm -rf "$wasm_dir"
else
    printf '\n%s\n' "=== WASM plugin ==="
    printf '  \033[33m⊘\033[0m %s\n' "skipped (no plugin path provided)"
fi

# ---------- Summary ----------

printf '\n%s\n' "=== Results ==="
total=$((passed + failed))
printf '%d/%d tests passed\n' "$passed" "$total"

if [[ $failed -gt 0 ]]; then
    printf '\033[31m%d test(s) FAILED\033[0m\n' "$failed"
    exit 1
fi

printf '\033[32mAll smoke tests passed.\033[0m\n'
