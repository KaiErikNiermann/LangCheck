#include "tree_sitter/parser.h"
#include <string.h>

/**
 * External scanner for tree-sitter-forester.
 *
 * Handles two constructs tree-sitter's regex engine can't express:
 *   - verbatim code fences: ```...```   (non-greedy cross-line match)
 *   - verbatim groups: !{...}           (nesting-aware match to the closing
 *                                        brace, e.g. \texfig!{\tikz{...}})
 */

enum TokenType {
    VERBATIM,
    VERBATIM_GROUP,
};

void *tree_sitter_forester_external_scanner_create(void) {
    return NULL;
}

void tree_sitter_forester_external_scanner_destroy(void *payload) {
    (void)payload;
}

unsigned tree_sitter_forester_external_scanner_serialize(void *payload, char *buffer) {
    (void)payload;
    (void)buffer;
    return 0;
}

void tree_sitter_forester_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    (void)payload;
    (void)buffer;
    (void)length;
}

/** Consume a ```...``` fence, starting at the first backtick. */
static bool scan_verbatim(TSLexer *lexer) {
    // Look for opening ```
    if (lexer->lookahead != '`') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '`') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '`') return false;
    lexer->advance(lexer, false);

    // Consume everything until closing ```
    int backtick_count = 0;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '`') {
            backtick_count++;
            lexer->advance(lexer, false);
            if (backtick_count == 3) {
                lexer->result_symbol = VERBATIM;
                return true;
            }
        } else {
            backtick_count = 0;
            lexer->advance(lexer, false);
        }
    }

    return false;
}

/** Consume a !{...} verbatim group, starting at the '!'.
 *
 * The body is verbatim, so nothing inside is interpreted as forester markup.
 * Braces are still counted so a nested group closes at the right place
 * (\texfig!{\tikz{a}{b}}), and a backslash escapes the following character so
 * a literal \{ or \} in TeX content cannot unbalance the count. */
static bool scan_verbatim_group(TSLexer *lexer) {
    if (lexer->lookahead != '!') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '{') return false;
    lexer->advance(lexer, false);

    unsigned depth = 1;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '\\') {
            lexer->advance(lexer, false);
            if (lexer->eof(lexer)) break;
            lexer->advance(lexer, false);
            continue;
        }
        if (lexer->lookahead == '{') {
            depth++;
        } else if (lexer->lookahead == '}') {
            depth--;
            if (depth == 0) {
                lexer->advance(lexer, false);
                lexer->result_symbol = VERBATIM_GROUP;
                return true;
            }
        }
        lexer->advance(lexer, false);
    }

    // Unterminated: report no token so the text parses as ordinary markup
    // rather than swallowing the rest of the document.
    return false;
}

bool tree_sitter_forester_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;

    if (!valid_symbols[VERBATIM] && !valid_symbols[VERBATIM_GROUP]) {
        return false;
    }

    // Skip any whitespace (tree-sitter may have already consumed extras,
    // but be safe)
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == '\n') {
        lexer->advance(lexer, true);  // true = skip (don't include in token)
    }

    if (valid_symbols[VERBATIM_GROUP] && lexer->lookahead == '!') {
        return scan_verbatim_group(lexer);
    }
    if (valid_symbols[VERBATIM] && lexer->lookahead == '`') {
        return scan_verbatim(lexer);
    }

    return false;
}
