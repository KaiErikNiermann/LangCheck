import eslint from "@eslint/js";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,
    unicorn.configs.recommended,
    security.configs.recommended,
    {
        // The same house-style exemptions as web/eslint.config.mjs, which
        // reuses this code: they are naming and layout preferences, not bugs.
        rules: {
            "unicorn/prevent-abbreviations": "off",
            "unicorn/name-replacements": "off",
            "unicorn/no-null": "off",
            "unicorn/filename-case": "off",
            "unicorn/single-line-block-comment-style": "off",
            "unicorn/no-asterisk-prefix-in-documentation-comments": "off",
            "unicorn/consistent-boolean-name": "off",
            "unicorn/consistent-class-member-order": "off",
            "unicorn/prefer-await": "off",
            "unicorn/prefer-then-catch": "off",
            "unicorn/switch-case-braces": "off",
            "unicorn/prefer-ternary": "off",
            // Byte offsets and UTF-16 code units are read on purpose.
            "unicorn/prefer-code-point": "off",
            // Index access is checked by noUncheckedIndexedAccess.
            "security/detect-object-injection": "off",
            // Flags every fs call whose path is computed, which is all of
            // src/core. CodeQL's path-injection and zip-slip queries follow
            // where a path comes from, and cover the cases that matter.
            "security/detect-non-literal-fs-filename": "off",
            // VS Code 1.85 (engines.vscode) runs on Node 18, which has neither
            // Array#toSorted nor the Iterator helpers these rules suggest.
            "unicorn/no-array-sort": "off",
            "unicorn/prefer-iterator-to-array": "off",
            // Spelling and layout preferences: none of them can be a bug.
            ...Object.fromEntries([
                "unicorn/numeric-separators-style", "unicorn/number-literal-case", "unicorn/escape-case",
                "unicorn/prefer-unicode-code-point-escapes", "unicorn/prefer-short-escape-sequences",
                "unicorn/prefer-string-raw", "unicorn/import-style", "unicorn/prefer-node-protocol",
                "unicorn/catch-error-name", "unicorn/no-useless-undefined", "unicorn/no-await-expression-member",
                "unicorn/prefer-simple-condition-first", "unicorn/prefer-single-call", "unicorn/prefer-early-return",
                "unicorn/no-negated-condition", "unicorn/no-nested-ternary", "unicorn/prefer-minimal-ternary",
                "unicorn/prefer-string-replace-all", "unicorn/prefer-split-limit", "unicorn/prefer-string-repeat",
                "unicorn/prefer-string-slice", "unicorn/no-unreadable-for-of-expression", "unicorn/prefer-combined-guards",
                "unicorn/no-useless-else", "unicorn/prefer-continue", "unicorn/prefer-switch", "unicorn/no-for-loop",
                "unicorn/prefer-default-parameters", "unicorn/prefer-number-properties", "unicorn/prefer-smaller-scope",
                "unicorn/no-useless-spread", "unicorn/consistent-conditional-object-spread",
                "unicorn/prefer-direct-iteration", "unicorn/no-declarations-before-early-exit",
                "unicorn/consistent-existence-index-check", "unicorn/prefer-at", "unicorn/no-for-each",
                "unicorn/prefer-number-coercion", "unicorn/no-non-function-verb-prefix",
                "unicorn/text-encoding-identifier-case", "unicorn/no-return-array-push", "unicorn/max-nested-calls",
                "unicorn/no-unnecessary-parameters", "unicorn/no-negated-array-predicate",
                "unicorn/prefer-event-target", "unicorn/consistent-function-scoping",
                "unicorn/prefer-array-some", "unicorn/no-unnecessary-array-flat-map",
                "unicorn/no-computed-property-existence-check",
                "sonarjs/no-nested-conditional", "sonarjs/no-nested-template-literals", "sonarjs/prefer-regexp-exec",
            ].map(rule => [rule, "off"])),
            // Reported, not gating: the eight functions above the limit are
            // refactors of their own.
            "sonarjs/cognitive-complexity": "warn",
        },
    },
    {
        // Build and test-runner scripts: they run in Node, configure by side
        // effect, and read and write their own output paths.
        files: ["*.mjs", ".*.mjs", "*.config.ts", "scripts/*.mjs"],
        languageOptions: { globals: globals.node },
        rules: {
            "unicorn/no-top-level-side-effects": "off",
            "security/detect-non-literal-fs-filename": "off",
        },
    },
    {
        // Mocha binds `this` to the test context, the tests read and write
        // their own fixture paths, and assertions live in shared helpers.
        files: ["src/test/**/*.ts"],
        rules: {
            "unicorn/no-this-outside-of-class": "off",
            "security/detect-non-literal-fs-filename": "off",
            "sonarjs/assertions-in-tests": "off",
            "unicorn/no-top-level-assignment-in-function": "off",
            "sonarjs/no-nested-functions": "off",
        },
    },
    {
        languageOptions: {
            parserOptions: {
                // The build and test-runner configs at the root are in no
                // tsconfig; they get the default project.
                projectService: {
                    allowDefaultProject: ["*.mjs", ".*.mjs", "*.config.ts", "scripts/*.mjs"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
            }],
            "@typescript-eslint/no-explicit-any": "warn",
            "no-console": "off",
        },
    },
    {
        // The end-to-end tests are compiled by tsconfig.test.json, which the
        // root config excludes so the main typecheck does not need mocha's
        // globals. Pointing the parser at that project is what lets eslint
        // read them at all.
        files: ["src/test/e2e/**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: "./tsconfig.test.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // Node's own I/O stays in src/core/: the process, the binary, the
        // network and the shell. Everything else talks to VS Code only, which
        // is what keeps the checking pipeline, the providers and the commands
        // portable to a web-extension host.
        files: ["src/**/*.ts"],
        ignores: ["src/core/**", "src/test/**"],
        rules: {
            "no-restricted-imports": ["error", {
                paths: ["fs", "child_process", "http", "https", "os", "zlib", "crypto", "net"].map(name => ({
                    name,
                    message: "Node I/O lives in src/core/; reach it through a service there.",
                })),
            }],
        },
    },
    {
        // extension.ts was a 3,600-line module; this keeps any file from
        // growing back into one.
        files: ["src/**/*.ts"],
        ignores: ["src/test/**", "src/generated/**", "src/proto/**"],
        rules: {
            "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
        },
    },
    {
        // .vscode-test/ holds whole VS Code installs (2 GB): `eslint .` ran
        // out of heap reading them.
        ignores: ["out/", "webview/", "src/proto/", "src/generated/", ".vscode-test/", "test-results/", "playwright-report/"],
    },
);
