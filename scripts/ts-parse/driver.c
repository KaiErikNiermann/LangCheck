// Standalone parse driver for one tree-sitter grammar, built by
// scripts/ts-parse/build.sh. The grammar's entry point is passed in as
// TS_LANGUAGE_FN, so the same driver links against any parser.c.
//
// usage: tree-sitter-<name> [-q] [FILE|-]
//   prints the S-expression of the parse tree to stdout, then every ERROR and
//   MISSING node as `row:col` (1-based) to stderr. Exit 0 on a clean tree, 1
//   if it has errors, 2 on usage or I/O failure. -q skips the tree.
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tree_sitter/api.h>

#ifndef TS_LANGUAGE_FN
#error "build with -DTS_LANGUAGE_FN=tree_sitter_<name>"
#endif

const TSLanguage *TS_LANGUAGE_FN(void);

static char *read_all(FILE *f, size_t *len) {
    size_t cap = 1 << 16;
    size_t n = 0;
    char *buf = malloc(cap);
    if (!buf) return NULL;
    size_t got;
    while ((got = fread(buf + n, 1, cap - n, f)) > 0) {
        n += got;
        if (n == cap) {
            cap *= 2;
            char *grown = realloc(buf, cap);
            if (!grown) {
                free(buf);
                return NULL;
            }
            buf = grown;
        }
    }
    if (ferror(f)) {
        free(buf);
        return NULL;
    }
    *len = n;
    return buf;
}

static void report_errors(TSNode node) {
    if (!ts_node_has_error(node)) return;
    bool missing = ts_node_is_missing(node);
    if (missing || ts_node_is_error(node)) {
        TSPoint p = ts_node_start_point(node);
        fprintf(stderr, "%u:%u: %s %s\n", p.row + 1, p.column + 1,
                missing ? "MISSING" : "ERROR", ts_node_type(node));
    }
    uint32_t count = ts_node_child_count(node);
    for (uint32_t i = 0; i < count; i++) report_errors(ts_node_child(node, i));
}

int main(int argc, char **argv) {
    bool quiet = false;
    const char *path = "-";
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-q") == 0) {
            quiet = true;
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("usage: %s [-q] [FILE|-]\n", argv[0]);
            return 0;
        } else {
            path = argv[i];
        }
    }

    FILE *f = strcmp(path, "-") == 0 ? stdin : fopen(path, "rb");
    if (!f) {
        perror(path);
        return 2;
    }
    size_t len = 0;
    char *src = read_all(f, &len);
    if (f != stdin) fclose(f);
    if (!src) {
        fprintf(stderr, "%s: read failed\n", path);
        return 2;
    }

    TSParser *parser = ts_parser_new();
    if (!ts_parser_set_language(parser, TS_LANGUAGE_FN())) {
        fprintf(stderr, "grammar ABI %u is not supported by this runtime\n",
                ts_language_abi_version(TS_LANGUAGE_FN()));
        return 2;
    }
    TSTree *tree = ts_parser_parse_string(parser, NULL, src, (uint32_t)len);
    TSNode root = ts_tree_root_node(tree);

    if (!quiet) {
        char *sexp = ts_node_string(root);
        puts(sexp);
        free(sexp);
    }
    report_errors(root);
    int status = ts_node_has_error(root) ? 1 : 0;

    ts_tree_delete(tree);
    ts_parser_delete(parser);
    free(src);
    return status;
}
