#include "tree_sitter/parser.h"

/**
 * External scanner for tree-sitter-tinylang.
 *
 * Handles code fence blocks: ~~~...~~~
 * tree-sitter regex can't do non-greedy cross-line matching,
 * so we handle it in C.
 */

enum TokenType {
    CODE_BLOCK,
};

void *tree_sitter_tinylang_external_scanner_create(void) {
    return NULL;
}

void tree_sitter_tinylang_external_scanner_destroy(void *payload) {
    (void)payload;
}

unsigned tree_sitter_tinylang_external_scanner_serialize(void *payload, char *buffer) {
    (void)payload;
    (void)buffer;
    return 0;
}

void tree_sitter_tinylang_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    (void)payload;
    (void)buffer;
    (void)length;
}

bool tree_sitter_tinylang_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;

    if (!valid_symbols[CODE_BLOCK]) {
        return false;
    }

    // Skip whitespace
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == '\n') {
        lexer->advance(lexer, true);
    }

    // Look for opening ~~~
    if (lexer->lookahead != '~') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '~') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '~') return false;
    lexer->advance(lexer, false);

    // Consume everything until closing ~~~
    int tilde_count = 0;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '~') {
            tilde_count++;
            lexer->advance(lexer, false);
            if (tilde_count == 3) {
                lexer->result_symbol = CODE_BLOCK;
                return true;
            }
        } else {
            tilde_count = 0;
            lexer->advance(lexer, false);
        }
    }

    return false;
}
