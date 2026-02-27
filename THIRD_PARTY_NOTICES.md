# Third-Party Notices

Language Check depends on the following third-party libraries. Each is listed with its license. Full license texts are available in each package's repository.

To regenerate this file from live dependency metadata, run:

```sh
./scripts/generate-third-party.sh
```

## Rust Dependencies

| Crate | License | Description |
|-------|---------|-------------|
| [anyhow](https://crates.io/crates/anyhow) | MIT OR Apache-2.0 | Flexible error handling |
| [async-trait](https://crates.io/crates/async-trait) | MIT OR Apache-2.0 | Async trait methods |
| [bytes](https://crates.io/crates/bytes) | MIT | Byte buffer utilities |
| [clap](https://crates.io/crates/clap) | MIT OR Apache-2.0 | Command-line argument parsing |
| [codebook-tree-sitter-latex](https://crates.io/crates/codebook-tree-sitter-latex) | MIT | Tree-sitter grammar for LaTeX |
| [console](https://crates.io/crates/console) | MIT | Terminal styling |
| [divan](https://crates.io/crates/divan) | MIT OR Apache-2.0 | Benchmarking framework |
| [extism](https://crates.io/crates/extism) | BSD-3-Clause | WebAssembly plugin system (Extism SDK) |
| [glob](https://crates.io/crates/glob) | MIT OR Apache-2.0 | File path pattern matching |
| [harper-core](https://crates.io/crates/harper-core) | Apache-2.0 | Grammar checking engine |
| [indicatif](https://crates.io/crates/indicatif) | MIT | Progress bar rendering |
| [insta](https://crates.io/crates/insta) | Apache-2.0 | Snapshot testing |
| [lru](https://crates.io/crates/lru) | MIT | LRU cache implementation |
| [prost](https://crates.io/crates/prost) | Apache-2.0 | Protocol Buffer implementation |
| [prost-build](https://crates.io/crates/prost-build) | Apache-2.0 | Protobuf code generation |
| [redb](https://crates.io/crates/redb) | MIT OR Apache-2.0 | Embedded key-value database |
| [regex](https://crates.io/crates/regex) | MIT OR Apache-2.0 | Regular expressions |
| [reqwest](https://crates.io/crates/reqwest) | MIT OR Apache-2.0 | HTTP client |
| [ropey](https://crates.io/crates/ropey) | MIT | Rope-based text buffer |
| [serde](https://crates.io/crates/serde) | MIT OR Apache-2.0 | Serialization framework |
| [serde_cbor](https://crates.io/crates/serde_cbor) | MIT OR Apache-2.0 | CBOR serialization |
| [serde_json](https://crates.io/crates/serde_json) | MIT OR Apache-2.0 | JSON serialization |
| [serde_yaml](https://crates.io/crates/serde_yaml) | MIT OR Apache-2.0 | YAML serialization |
| [tokio](https://crates.io/crates/tokio) | MIT | Async runtime |
| [tree-sitter](https://crates.io/crates/tree-sitter) | MIT | Incremental parsing framework |
| [tree-sitter-html](https://crates.io/crates/tree-sitter-html) | MIT | Tree-sitter grammar for HTML |
| [tree-sitter-markdown](https://crates.io/crates/tree-sitter-markdown) | MIT | Tree-sitter grammar for Markdown |
| [whatlang](https://crates.io/crates/whatlang) | MIT | Natural language detection |

## TypeScript Dependencies

| Package | License | Description |
|---------|---------|-------------|
| [@sveltejs/vite-plugin-svelte](https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte) | MIT | Svelte integration for Vite |
| [@vscode/l10n](https://www.npmjs.com/package/@vscode/l10n) | MIT | VS Code localization API |
| [autoprefixer](https://www.npmjs.com/package/autoprefixer) | MIT | CSS vendor prefix tool |
| [long](https://www.npmjs.com/package/long) | Apache-2.0 | 64-bit integer support |
| [postcss](https://www.npmjs.com/package/postcss) | MIT | CSS transformation tool |
| [protobufjs](https://www.npmjs.com/package/protobufjs) | BSD-3-Clause | Protocol Buffer runtime |
| [svelte](https://www.npmjs.com/package/svelte) | MIT | Reactive UI framework |
| [svelte-check](https://www.npmjs.com/package/svelte-check) | MIT | Svelte type checker |
| [tailwindcss](https://www.npmjs.com/package/tailwindcss) | MIT | Utility-first CSS framework |
| [typescript](https://www.npmjs.com/package/typescript) | Apache-2.0 | TypeScript compiler |
| [vite](https://www.npmjs.com/package/vite) | MIT | Frontend build tool |
| [vitest](https://www.npmjs.com/package/vitest) | MIT | Test framework |

## Optional Services

| Service | License | Description |
|---------|---------|-------------|
| [LanguageTool](https://languagetool.org/) | LGPL-2.1 | Grammar checking server (optional, self-hosted via Docker) |

---

This file lists direct dependencies only. Transitive dependency licenses are audited by `cargo deny` (see `rust-core/deny.toml`). Allowed licenses: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unicode-3.0, Unicode-DFS-2016, Zlib, OpenSSL, CC0-1.0, BSL-1.0, MPL-2.0.
