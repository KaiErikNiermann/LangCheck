import eslint from '@eslint/js';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Invisible and formatting characters (C0/C1 controls, soft hyphen,
// zero-width and bidi controls, word joiners, BOM, U+FFF0-FFFF specials) as
// a regex character class, built from code points so that no such character
// sits in this file either: tooling here has turned escapes into literal
// characters three times.
const INVISIBLE_RANGES = [[0x0, 0x8], [0xB, 0xC], [0xE, 0x1F], [0x7F, 0x9F], [0xAD, 0xAD], [0x20_0B, 0x20_0F], [0x20_28, 0x20_2E], [0x20_60, 0x20_6F], [0xFE_FF, 0xFE_FF], [0xFF_F0, 0xFF_FF]];
/** @param {number} n */
const codePoint = (n) => String.raw`\u{${n.toString(16)}}`;
/** @param {[number, number]} range */
const classRange = ([from, to]) => (from === to ? codePoint(from) : [codePoint(from), codePoint(to)].join('-'));
const INVISIBLE = `[${INVISIBLE_RANGES.map((r) => classRange(/** @type {[number, number]} */ (r))).join('')}]`;
const ESCAPE_MESSAGE = String.raw`Write invisible or formatting characters as \u escapes.`;

export default defineConfig(
    { ignores: ['dist/', 'dist-test/', 'test-results/', 'playwright-report/', '.e2e/'] },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    sonarjs.configs.recommended,
    unicorn.configs.recommended,
    security.configs.recommended,
    {
        languageOptions: {
            parserOptions: { project: ['./tsconfig.test.json'], tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            // The shim mirrors VS Code's names (TextDocument, Uri, ...) and the
            // reused client code; abbreviations like `doc` and `e` match it.
            'unicorn/prevent-abbreviations': 'off',
            // `null` is CM6's and the DOM's own return value (posAtCoords, coordsAtPos).
            'unicorn/no-null': 'off',
            // Class and helper files are camelCase across the extension already.
            'unicorn/filename-case': 'off',
            // House style across lang-check: multi-line `//` comment blocks and
            // JSDoc with leading asterisks, as in the reused client code.
            'unicorn/single-line-block-comment-style': 'off',
            'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
            // Successor of prevent-abbreviations; same reason as above.
            'unicorn/name-replacements': 'off',
            // Names follow the vscode API the shim mirrors (`isEmpty`, `visible`).
            'unicorn/consistent-boolean-name': 'off',
            // Members are ordered to read top-down, as in the rest of the extension.
            'unicorn/consistent-class-member-order': 'off',
            // In an extension's content script, `window` is the page's window
            // and `globalThis` is the script's sandbox: not interchangeable.
            // The autofix rewrote a message-source check into one that is
            // always true.
            'unicorn/prefer-global-this': 'off',
            // CM6 offsets are UTF-16 code units; this code reads code units on
            // purpose (surrogate checks, byte strings for base64).
            'unicorn/prefer-code-point': 'off',
            // Conflicting pair; promise chains stay where they read better.
            'unicorn/prefer-await': 'off',
            'unicorn/prefer-then-catch': 'off',
            // The reused client code writes unbraced cases.
            'unicorn/switch-case-braces': 'off',
            // Iterator#toArray is Firefox 131+; the extension supports 128.
            'unicorn/prefer-iterator-to-array': 'off',
            // A ternary of two side-effecting calls reads worse than if/else.
            'unicorn/prefer-ternary': 'off',
            // Index access on parsed, bounded arrays is checked by noUncheckedIndexedAccess.
            'security/detect-object-injection': 'off',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
            'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
            // Invisible and formatting characters must be written as escapes:
            // as literals they are unreadable in review (INVISIBLE above).
            'no-restricted-syntax': [
                'error',
                { selector: `Literal[raw=/${INVISIBLE}/u]`, message: ESCAPE_MESSAGE },
                { selector: `TemplateElement[value.raw=/${INVISIBLE}/u]`, message: ESCAPE_MESSAGE },
            ],
        },
    },
    {
        // Node's builtins exist only in the build and the test harness. In
        // src/ they would bundle into a browser extension that cannot run them.
        files: ['src/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', 'fs', 'path', 'child_process', 'os', 'crypto', 'http', 'https', 'zlib', 'buffer'], message: 'src/ runs in the browser.' }] }],
            'no-restricted-globals': ['error', { name: 'Buffer', message: 'src/ runs in the browser; use TextEncoder.' }, { name: 'process', message: 'src/ runs in the browser.' }],
        },
    },
    {
        // The shim mirrors the vscode API: its events are EventEmitters, and
        // its stubs keep VS Code's parameters (named _x) even when unused.
        files: ['src/shim/vscode.ts'],
        rules: {
            'unicorn/prefer-event-target': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // VS Code's own signatures (get<T>(key): T | undefined).
            '@typescript-eslint/no-unnecessary-type-parameters': 'off',
        },
    },
    {
        files: ['test/**/*.ts', 'test/**/*.mjs', '*.mjs', '*.mts', '*.config.ts'],
        languageOptions: { globals: globals.node },
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            'sonarjs/no-nested-functions': 'off',
            'unicorn/no-top-level-await': 'off',
            // fast-check properties are asserted by running; `void` discards
            // the value on purpose.
            'sonarjs/void-use': 'off',
            'sonarjs/assertions-in-tests': 'off',
            'unicorn/max-nested-calls': 'off',
            'unicorn/consistent-function-scoping': 'off',
            // Config files and the build script are side effects by nature.
            'unicorn/no-top-level-side-effects': 'off',
            // The build script writes to its own output directory.
            'security/detect-non-literal-fs-filename': 'off',
            // The tests serve stand-in pages on loopback over plain http.
            'sonarjs/no-clear-text-protocols': 'off',
            'unicorn/prefer-https': 'off',
            // `(x) => expect(x)...` shorthands in test tables.
            '@typescript-eslint/no-confusing-void-expression': 'off',
            // The fake host page swaps its view the way a site remounts one.
            'unicorn/no-top-level-assignment-in-function': 'off',
            // page.evaluate() callbacks run in the browser, where its globals
            // (CSS, Highlight) exist.
            'unicorn/isolated-functions': 'off',
            // Playwright fixtures take `{}` when they use no other fixture.
            'no-empty-pattern': 'off',
            // page.evaluate() returns what the page hands back, typed any.
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            // Test locators build anchored patterns from literal test words.
            'security/detect-non-literal-regexp': 'off',
        },
    },
);
