#include "tree_sitter/parser.h"
#include <string.h>

/**
 * External scanner for tree-sitter-forester.
 *
 * Handles verbatim code fences: ```...```
 * tree-sitter regex can't do non-greedy cross-line matching,
 * so we handle it in C.
 */

enum TokenType {
    VERBATIM,
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

bool tree_sitter_forester_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;

    if (!valid_symbols[VERBATIM]) {
        return false;
    }

    // Skip any whitespace (tree-sitter may have already consumed extras,
    // but be safe)
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == '\n') {
        lexer->advance(lexer, true);  // true = skip (don't include in token)
    }

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
