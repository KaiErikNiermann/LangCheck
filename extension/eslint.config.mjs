import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
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
        ignores: ["out/", "webview/", "src/proto/", "src/generated/"],
    },
);
