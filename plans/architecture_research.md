# The Ultimate Language Checking VS Code Extension: Research & Architecture

This document serves as a comprehensive research report and architectural blueprint for building the perfect, natively-performant, markup-agnostic language checking extension for Visual Studio Code. It addresses the severe flaws in existing ecosystem tools (like LTeX and standard LanguageTool wrappers) and incorporates modern, high-performance tooling paradigms.

---

## 1. Problem Analysis & Existing Solutions

### 1.1 The Flaws of Current Solutions (LTeX, LanguageTool LS)
The provided reference repositories (`languagetool-languageserver` and `ltex-ls-plus`) represent the current state-of-the-art, but suffer from fatal architectural flaws:
* **JVM Dependency & Overhead:** Both rely on the Java Virtual Machine. This results in heavy memory consumption, slow startup times, and difficult deployment in VS Code (requiring Java installations).
* **Regex-based Markup Stripping:** They use ad-hoc Regex or basic parsers to strip Markdown/LaTeX. This is brittle. When you introduce new markup (like MDX, Astro, or complex HTML), regex fails, leading to massive false positives.
* **Inconsistent Scope Checking:** Workspace vs. Single Document checking is notoriously inconsistent because the LSP server drops document context or fails to scale when running heavy JVM tasks concurrently across a workspace.
* **Cumbersome UX:** Fixing 100 spelling mistakes requires clicking 100 lightbulbs. The ignore rules are often hidden deep in `settings.json` and don't gracefully handle complex text boundaries.

### 1.2 Inspiration: Forester's `speedfix.ts`
The `speedfix.ts` implementation demonstrates a crucial paradigm shift in UX:
* **Bulk Keyboard Resolution:** Instead of relying purely on LSP Code Actions (lightbulbs), it aggregates diagnostics into a Webview.
* **Ergonomics:** Users press `1-9` to pick a fix, `A` to add to the dictionary, `H` to hide, and `Space` to skip. It auto-advances. This is 10x faster than standard VS Code QuickFix workflows.
* *Gap to fill:* It relies on hardcoded string matching and regex to filter out false positives instead of structural understanding.

### 1.3 State of Non-AI Fast Spell Checkers
* **[Typos](https://github.com/crate-ci/typos):** Rust-based, insanely fast, zero-config spell checker specifically designed for source code. It achieves low false positives by understanding code identifiers (camelCase, snake_case).
* **[Harper](https://github.com/Automattic/harper):** An offline, privacy-first grammar checker built in Rust. It is the closest native competitor to LanguageTool, built for developers.
* **[CSpell](https://github.com/streetsidesoftware/cspell):** TypeScript-based regex spell checker. Highly configurable but can bottleneck on large monorepos due to Node.js single-threaded constraints.

---

## 2. Core Architecture & Tech Stack

To achieve blazing speed, true markup agnosticism, and rock-solid reliability, we must abandon the JVM and Regex.

### 2.1 Technology Choices
1. **Core Engine:** **Rust**. Rust provides predictable performance, zero-cost abstractions, fearless concurrency (for workspace-wide checks), and cross-platform compilation (native binaries or WASM).
2. **Text Extraction:** **Tree-sitter**. This is the secret to markup-agnosticism. Tree-sitter generates precise ASTs (Abstract Syntax Trees) for almost any language. Instead of stripping markup via Regex, we traverse the Tree-sitter AST and *only extract* nodes marked as prose, comments, or strings.
3. **Primary Grammar Engine:** **Harper (`harper-core`)**. A native Rust grammar checker designed for developers. It is extremely fast, offline, and handles English dialects perfectly.
4. **Fallback Grammar Engine:** **LanguageTool (via HTTP API)**. For non-English languages (German, French, etc.), we bridge to the LanguageTool HTTP API (local or remote), avoiding JVM embedding in our binary.
5. **VS Code Extension Client:** **TypeScript** using **Effect (Effect-TS)** for robust, error-free async state management, and **ts-pattern** for elegant message/AST pattern matching.
6. **Communication:** **Protobuf over Stdio/Unix Sockets**. We bypass the overhead of JSON-RPC/LSP string serialization in favor of a high-performance binary protocol using **Prost** (Rust) and **protobufjs** (TypeScript). This ensures minimal latency and type-safe contracts across the language boundary.

### 2.2 Agnostic Provider Architecture & Protobuf Contract

To ensure the system is fully future-proof and checker-agnostic, we implement a **Provider-based Architecture**. The "Core Engine" acts as a high-performance **Orchestrator** that communicates with any number of "Checker Providers" using a standardized binary contract.

#### The Protobuf Contract (`checker.proto`)
The source of truth for all communication is a strictly defined Protobuf schema. This allows *any* language or tool to act as a checker by simply implementing this interface.

```proto
syntax = "proto3";

package languagecheck;

service CheckerProvider {
  // Main check request
  rpc Checkprose(CheckRequest) returns (CheckResponse);
  // Get available rules/settings for this provider
  rpc GetMetadata(MetadataRequest) returns (MetadataResponse);
}

message CheckRequest {
  string text = 1;
  string language_id = 2;
  map<string, string> settings = 3;
}

message CheckResponse {
  repeated Diagnostic diagnostics = 1;
}

message Diagnostic {
  uint32 start_byte = 1;
  uint32 end_byte = 2;
  string message = 3;
  repeated string suggestions = 4;
  string rule_id = 5;
  Severity severity = 6;
}
```

#### Multi-Engine Orchestration
The Orchestrator (Rust Core) manages the lifecycle and routing of these providers:
*   **Built-in Providers:** Harper and the LanguageTool HTTP bridge are implemented as internal modules that satisfy the `CheckerProvider` interface.
*   **External Native Providers:** Users can register external binaries that speak the binary Protobuf protocol over stdio/pipes.
*   **Thin Adapters:** For legacy tools or remote APIs not natively supporting Protobuf, developers only need to write a "Thin Adapter" (a small Rust or TS wrapper) that translates the tool's output into our standard Protobuf format.

### 2.3 System Architecture

```text
[ VS Code Extension (TS) ] <=== Protobuf Contract ===> [ Orchestrator (Rust Core) ]
        |                                                     |
        |-- SpeedFix UI                                       |-- Tree-sitter Manager
        |-- Extension API                                     |-- Ignore/Dictionary Trie
                                                              |-- Rule Normalization Layer
                                                              |-- Provider Registry
                                                                    |-- [ Harper (Native) ]
                                                                    |-- [ LT Bridge (HTTP) ]
                                                                    |-- [ External Adapters (Protobuf) ]
                                                                    |-- [ WASM Plugins (Extism) ]
```

### 2.4 Unified Rule Taxonomy & Normalization Layer

To prevent a "fragmented configuration" where users must manage different rule IDs for every backend (e.g., `MORFOLOGIK_RULE_EN_US` in LanguageTool vs. `SpelledCorrectly` in Harper), we implement a **Rule Normalization Layer**.

#### 1. The Unified Taxonomy
We define a hierarchical, human-readable taxonomy for all language errors:
*   `spelling.typo`: Basic spelling errors.
*   `grammar.agreement`: Subject-verb agreement.
*   `style.verbosity`: Wordy or redundant phrasing.
*   `style.passive_voice`: Passive voice detection.
*   `typography.punctuation`: Missing or incorrect punctuation.

#### 2. The Normalization Mapping
Each Checker Provider contributes a **Mapping Schema** that translates its internal IDs to the Unified Taxonomy.

```yaml
# harper_mapping.yaml
provider: "harper"
mappings:
  - native_id: "SpelledCorrectly"
    unified_id: "spelling.typo"
  - native_id: "RepeatedWord"
    unified_id: "typography.repeated_word"

# languagetool_mapping.yaml
provider: "languagetool"
mappings:
  - native_id: "MORFOLOGIK_RULE_EN_US"
    unified_id: "spelling.typo"
  - native_id: "DOUBLE_PUNCTUATION"
    unified_id: "typography.punctuation"
```

#### 3. Benefits of Normalization
*   **Deduplication:** If two providers report the same `unified_id` at the same byte range, the Orchestrator can merge them into a single diagnostic, preferring the one with higher confidence.
*   **Consistent Configuration:** Users can disable `style.passive_voice` once in `.languagecheck.yaml`, and the Orchestrator will automatically disable the relevant native rules across all active backends.
*   **Searchable Rules:** The "Inspector" dashboard and CLI can list rules across all providers filtered by the unified category.

---

## 3. Solving the Hard Problems

### 3.1 True Markup-Agnosticism via Tree-sitter
Instead of writing a custom parser for LaTeX, HTML, and Markdown, we map Tree-sitter node types to a "Prose Extractor".
* **How it works:** When a document is opened, the Rust core parses it with the respective Tree-sitter grammar.
* **Querying:** We use Tree-sitter queries (e.g., `(paragraph) @prose`, `(comment) @prose`) to extract just the text and its absolute byte offsets.
* **Result:** The spell checker only sees pure text. Code blocks, tags, and macros are structurally ignored.

### 3.2 Multi-Language Documents & Hybrid Scoping
To support documents containing multiple natural languages (e.g., an English technical manual with French and German translations inlined), we implement a hybrid scoping system.

#### 1. Annotation-based Scoping (Manual)
Users can manually tag blocks of text using standardized comment annotations, similar to formatter toggles (`# fmt: off`).
*   **Syntax:** `<!-- lang: fr -->` or `// @lang: de`.
*   **Mechanism:** The Tree-sitter/Meta-Parser identifies these "Scope Markers" and assigns the specified `language_id` to all subsequent prose nodes until another marker or the end of the block is reached.

#### 2. Heuristic Detection (Automatic)
For untagged text, the Orchestrator uses a high-performance detection pipeline:
*   **Engine:** Uses **whatlang** or **lingua-rs** in the Rust core for sub-millisecond language identification.
*   **Granularity:** Detection happens at the "Segment" level (usually a paragraph or a top-level AST node).
*   **Routing:** Each segment is routed to the corresponding Checker Provider (e.g., English segments to Harper, French to LanguageTool) based on the highest-confidence detected language.

### 3.3 Workspace Consistency & Speed
* **Solution:** The Rust LSP uses a multi-threaded architecture (e.g., `tokio`).
  * Thread 1: Handles immediate keystrokes/active document checking (sub 10ms latency).
  * Thread 2 (Background): Recursively walks the workspace, parses files via Tree-sitter, and populates a global diagnostics database (using a fast embedded KV store like `redb`).
  * Caching: Hash the AST of files. If a file hasn't changed, load diagnostics instantly from cache.

### 3.4 Language Changing & State
* **Solution:** Store the language state in the Rust LSP. Provide a permanent Status Bar item in VS Code (e.g., `Spell: EN-US`). Clicking it opens a native QuickPick menu to swap the active dictionary instantly across the whole workspace.

### 3.5 Extreme High Performance Mode (HPM)
To ensure the extension remains the "Ultimate" tool even on lower-end hardware (e.g., older laptops or remote SSH environments), we implement a dedicated **High Performance Mode**.

* **Feature Restrictions:**
    - **No WASM Plugins:** Disables the Extism runtime entirely to save memory and CPU cycles.
    - **English-Only (Local):** Disables the LanguageTool HTTP bridge and Fallback Engine. Only `harper-core` is used.
    - **Meta-Parser Only:** Replaces the heavy Tree-sitter AST queries with the ultra-fast SLS Meta-Parser (regex-automata).
    - **Shallow Diagnostics:** Disables complex grammar rules in Harper, focusing purely on high-precision spelling and basic punctuation.
* **Optimization Strategies:**
    - **Aggressive Debouncing:** Increases the time between keystrokes and checking triggers (e.g., from 50ms to 500ms).
    - **Dictionary Pruning:** Uses a smaller, pruned version of the spelling Trie for common English words only.
    - **Memory-Mapped I/O:** Leverages `mmap` for dictionary loading to reduce resident set size (RSS).
* **UI Minimalist Mode:** The SpeedFix UI disables heavy CSS transitions and virtualization, switching to a lightweight "Low-Resource" mode.

### 3.6 Optional Auto-Fix with Confidence-Based Correction
An **optional, user-opt-in** auto-fix feature will be provided to quickly correct common, high-confidence errors.

* **High-Confidence Threshold:** Only suggestions from the core grammar engines (Harper/LanguageTool) that come with an exceptionally high confidence score (e.g., a simple typo with a single, clear correction) will be eligible for auto-fixing.
* **Context-Aware Validation:** Before applying an auto-fix, the Rust core will perform an additional check using the **Tree-sitter AST** to ensure the fix does not inadvertently alter code, keywords, or string literals where the "error" might be intentional (e.g., "its" in a file path `foo/bar/its_a_file.txt`).
* **User-Defined Auto-Fix Rules:** Users can define their own custom `find -> replace` rules (e.g., "dont" -> "don't", "recieve" -> "receive") with optional context filters, stored in a configuration file.
* **Learning & Personalization (Future Work):** The system could, over time, learn from frequently accepted QuickFixes or SpeedFix actions to suggest personalized auto-fix rules.
* **Explicit User Consent:** This feature will be off by default and require explicit user activation in settings. All auto-fixes will be highlighted or visually indicated.

---

## 4. Extensibility & Extension Integration

### 4.1 The Integration API
The extension will expose a public API that other extensions can consume via `vscode.extensions.getExtension('publisher.language-check').exports`.

```typescript
export interface LanguageCheckAPI {
    registerIgnoreRanges(uri: vscode.Uri, ranges: vscode.Range[]): void;
    registerLanguageQuery(languageId: string, query: string): void;
    
    /**
     * Register a new Checker Provider.
     * Other extensions can register their own checker by providing a 
     * command that launches a Protobuf-compatible server.
     */
    registerExternalProvider(config: CheckerProviderConfig): void;
    
    checkDocument(uri: vscode.Uri): Promise<LanguageDiagnostic[]>;
}
```

### 4.2 Tree-sitter Query Contribution
Instead of hardcoding every markup language, we allow other extensions to contribute `.scm` files (Tree-sitter queries).
* **Dynamic Loading:** The Rust core watches these query files. When a file of `languageX` is opened, it loads the contributed query to extract prose.

### 4.3 LSP-as-a-Source (Advanced Integration)
While the core uses Tree-sitter for speed, developers building External Providers can use tools like **multilspy** to bridge existing LSPs. This allows for "Context-Aware" checking (e.g., using a C# LSP to identify documentation blocks before sending them to our orchestrator).

---

## 5. The Meta-Parser: Rapid Support for Any Language

### 5.1 The Simplified Language Schema (SLS)
For languages without a Tree-sitter grammar, we provide a YAML-based schema.

```yaml
id: "my-custom-markup"
inherits: "markdown-base"
structure:
  comments:
    - line: "%%"
    - block: { start: "/*", end: "*/" }
  skip_blocks:
    - { start: "\\begin{code}", end: "\\end{code}" }
  prose_macros:
    - { command: "\\footnote", content: "prose" }
```

### 5.2 The Virtual AST Generator
The Rust core includes a generator that compiles these SLS configs into highly-optimized **Regex-Automata**. This allows support for new DSLs with zero coding.

---

## 6. Advanced Plugin System & Prose Linting

### 6.1 WASM-based Dynamic Plugins (The "Heavy" Layer)
For complex logic (e.g., passive voice detection, syllable counting), we use a **WASM** plugin system powered by **Extism**.
* **Why WASM?** Sandboxed, cross-language, and natively fast.
* **The Plugin Host:** The Rust core loads `.wasm` files from a `.languagecheck/plugins` directory.

### 6.2 YAML-based Prose Rules (The "Lite" Layer)
Inspired by **Vale**, we provide declarative pattern matching for word-choice rules.

```yaml
id: "no-fillers"
severity: "warning"
patterns: ["basically", "literally", "actually"]
```

---

## 7. Intelligent & Persistent Ignore Rules

### 7.1 Structural Hashing (Stable Across Reformats)
Instead of character offsets, we store a **Structural Fingerprint**:
* **AST Path:** Route from root to ignored node.
* **Context Hash:** Salted hash of the sentence (minus whitespace).
* **Fuzzy Anchor:** Word neighbors (3 before/after).
**Benefit:** Ignore rules survive Prettier reformatting and text additions elsewhere in the file.

### 7.2 The "Ignore-Sync" Meta-Plan (Research Tasks)
- [ ] **LSP Range Tracking:** Leverage `textDocument/didChange` to "float" ignore ranges in memory.
- [ ] **Content-Addressable Ignores:** Store the *intent* of the ignore for global project-wide suggestions.

---

## 8. Developer & Debug Tooling

### 8.1 The "Inspector" Webview
A Svelte-based Webview for real-time engine analysis.
* **AST Visualizer:** Live Tree-sitter AST view with prose/ignore highlighting.
* **Extraction Trace:** See the raw prose stream sent to the engines.
* **Latency Profiler:** Execution time breakdown for each stage.

### 8.2 Core Management
* **Core Binary Autodownload:** The extension will feature a "lean-style" autodownload mechanism. On first activation or update, it will automatically download the appropriate Rust core binary for the user's OS and architecture.
    *   **Security:** This process will prioritize security by verifying checksums against a trusted manifest (e.g., GitHub Releases) and, if necessary, obtaining explicit user consent.
    *   **Fallback:** If autodownload is not possible or desired, the extension will provide clear, actionable instructions within VS Code, including direct links to download the binary manually.
* **Core Switcher:** Hot-swap between Rust binary versions (stable, canary, dev).
* **Protobuf Message Trace:** A dedicated Output Channel that decodes and displays the binary Protobuf traffic between the TS client and Rust core for debugging.

---

## 9. First-Class Benchmarking

### 9.1 Rust Micro-benchmarking (`divan`)
* **Target Areas:** Tree-sitter extraction, Aho-Corasick trie lookups, Harper throughput.
* **Continuous Evaluation:** PRs must include benchmark diffs.

### 9.2 Continuous Benchmarking (CI Integration)
* **Automated Regression Detection:** Build fails if critical paths slow down by >5%.
* **Historical Tracking:** Dashboard to visualize performance trends over time.

---

## 10. The "SpeedFix" Feature (Keyboard-driven Resolution)

1. **Invocation:** User runs `LanguageCheck: Open SpeedFix`.
2. **Ergonomics:**
   * `1-9`: Select suggestion.
   * `A`: Add to Workspace Dictionary.
   * `I`: Ignore in this file.
   * `Space`: Skip to next.
3. **Performance:** Uses Svelte list virtualization to handle thousands of issues without UI lag.

---

## 11. Quality Assurance & Testing

To build a flawless extension, testing must be rigorous, multi-tiered, and **multiplatform** from the outset.

### 11.1 Strict Tooling
* **Rust:** `clippy::pedantic` and `clippy::nursery`.
* **TypeScript:** `strict: true`, ESLint (`sonarjs`, `unicorn`, `security`).
* **Webview Testing:** **Vitest + Browser Mode (Playwright)**. Components are tested in real headless browsers with mocked VS Code APIs.

#### Webview Architecture (SpeedFix UI) - Styling Hygiene
To avoid the "brittle HTML-in-string" anti-pattern, we use a modern component-based approach.
* **Framework:** **Svelte** + **Vite**.
* **Styling & Hygiene:** **Tailwind CSS**. We use the `tailwindcss-vscode-colors` plugin to ensure the UI automatically respects the user's VS Code theme (e.g., `bg-vscode-editor-background`). From the outset, we will enforce styling hygiene by leveraging:
    *   **Component Classes (`@apply`):** Centralizing common utility combinations into semantic classes using Tailwind's `@apply` directive.
    *   **Theming & Design Tokens:** Extending `tailwind.config.js` to define custom utilities, colors, and design tokens, ensuring a single source of truth for styling decisions.
    *   **Encapsulated Components:** Styling is tightly coupled with Svelte components, promoting modularity and maintainability.
* **Communication:** Type-safe message passing using a shared `Events` schema between the Extension and the Webview.

### 11.2 Testing Tiers
* **Multiplatform Testing:** All unit, integration, and end-to-end tests will be executed across **Linux, macOS, and Windows** to guarantee consistent behavior and compatibility of the native Rust core and TypeScript extension.
* **Snapshot Testing (`insta`):** Verify diagnostic consistency for complex markup.
* **E2E Testing:** `@vscode/test-electron` for full extension integration.

---

## 12. CI/CD Pipeline & Development Workflow

To ensure high performance and reliability, we implement a multi-layered automated workflow that catches issues *before* they reach the repository.

### 12.1 Pre-push Hooks (Lefthook)
We use **Lefthook** for lightning-fast, concurrent Git hooks. It is significantly faster than Husky and handles monorepo-style structures natively.

* **Pre-push Configuration (`lefthook.yml`):**
  * **Rust Core:**
    - `cargo check`: Ensure it compiles.
    - `cargo clippy`: Enforce strict linting.
    - `cargo fmt --check`: Verify formatting.
    - `cargo test`: Run unit and extraction tests.
  * **TS Extension:**
    - `pnpm run lint`: ESLint with `sonarjs`, `unicorn`, `security`.
    - `pnpm run type-check`: Strict TSC validation.
    - `pnpm run test`: Vitest unit tests for the extension logic.
  * **Webview:**
    - `pnpm run test:browser`: Headless Playwright tests for Svelte components.

### 12.2 GitHub Actions Pipeline
A 4-stage pipeline triggered on every Pull Request and Push to `main`. **Crucially, these workflows are intelligently constrained to trigger only on changes to relevant files/directories** (e.g., Rust changes trigger Rust CI, TypeScript changes trigger TS extension CI), significantly mitigating unnecessary action minutes and speeding up feedback cycles.

1. **Stage: Lint & Audit**
   - Run `cargo-deny` for license auditing.
   - Run `eslint` and `clippy`.
   - Security audit for pnpm and cargo dependencies.
   - **Trigger Constraint:** Only runs if changes in `rust/`, `src/`, `package.json`, `Cargo.toml`, `.github/workflows/` etc.
2. **Stage: Test (Cross-Platform)**
   - Run the full test suite on **Linux, macOS, and Windows** runners to ensure the Rust core and Protobuf comms are stable across OS boundaries.
   - **Trigger Constraint:** Only runs if changes in `rust/`, `src/`, `Cargo.toml`, `.github/workflows/` etc.
3. **Stage: Benchmark**
   - Execute `divan` benchmarks.
   - Use `criterion-compare-action` to fail the build if a performance regression > 5% is detected.
   - **Trigger Constraint:** Only runs if changes in `rust/`, `Cargo.toml`, `benches/`, `.github/workflows/` etc.
4. **Stage: Build & Release (CD)**
   - **Multi-target Cross-Compilation:** Use `cross` or `cargo-zigbuild` to compile the Rust core for `x86_64` and `aarch64` (Apple Silicon & Linux).
   - **VSIX Packaging:** Bundle the TS extension and the respective native binaries into a single `.vsix`.
   - **Automated Release:** Tagged releases automatically push to the VS Code Marketplace and Open VSX.
   - **Trigger Constraint:** Only runs on push to `main` or tagged releases.

### 12.3 Documentation Portal (Sphinx & Read the Docs)
A comprehensive documentation portal will be built using **Sphinx** with the popular **Read the Docs theme**.
*   **Content:** This will include detailed guides on installation, configuration, extending with custom providers/plugins, API references, and troubleshooting.
*   **Dark Mode Support:** The Read the Docs theme inherently supports dark mode, ensuring a pleasant reading experience for all developers.
*   **Localization (i18n):** The documentation itself will be fully localized (using `sphinx-intl`). Community members can contribute translations for the guides and API references to ensure the tool is accessible to non-English speaking developers globally.
*   **Automated Deployment:** The documentation will be automatically built and deployed (e.g., to GitHub Pages or Read the Docs) as part of the CI/CD pipeline.

### 12.4 Dependabot Integration
To maintain security and keep dependencies up-to-date, **Dependabot** will be configured to automatically create Pull Requests for:
*   Rust `Cargo.toml` dependencies.
*   TypeScript `pnpm-lock.yaml` dependencies.
This ensures continuous, automated security patching and feature updates with minimal manual overhead.

---

## 13. Personalization & UX Enhancements

Beyond the core checking logic, several UX features will be implemented to make the tool feel like a natural extension of the developer's thought process.

### 13.1 Inlay Hints & Ghost Text
For high-confidence corrections (e.g., missing commas, common typos), the extension will provide **Inlay Hints**.
*   **Non-Intrusive:** Suggestions appear as subtle "Ghost Text" at the end of a word or in-line.
*   **One-Key Fix:** Users can press `Tab` or a specific shortcut to accept the inlay hint immediately without opening a menu.

### 13.2 Domain-Specific Dictionary Detection
The Orchestrator will automatically suggest enabling specialized dictionaries based on the workspace content:
*   **Software Engineering:** Automatically enabled for `.rs`, `.ts`, `.cpp` files.
*   **Medical/Legal/Scientific:** Suggested if the engine detects a high density of specialized terminology.

### 13.3 Collaborative Dictionaries (Team Wordlists)
In addition to `.languagecheck/dictionary.txt`, the extension supports **Remote Dictionary URLs**.
*   **Big Orgs:** Teams can host a central dictionary on an internal server.
*   **Sync:** The extension periodically fetches and merges these remote lists into the local Trie for zero-latency checking.

### 13.4 Proactive Prose Completion (Ghost Text & Targeted Edits)
Inspired by **GitHub Copilot's Next Edit Suggestions (NES)**, the extension will transition from a reactive "Squiggle-and-Fix" tool to a proactive writing assistant.

*   **Inline Completion Provider:** We leverage `vscode.languages.registerInlineCompletionItemProvider`. When the user pauses or finishes a sentence, the Rust Orchestrator performs a "Shadow Check" of the surrounding context.
*   **Targeted Ghost Text:** If a high-confidence correction is found (e.g., a missing article or a common subject-verb agreement error), the extension displays **Ghost Text** at the exact location of the error, even if the cursor is further ahead in the document.
*   **One-Key Application:** Users can press `Tab` to jump to and apply the suggestion instantly. This eliminates the friction of moving the mouse to a squiggle.
*   **Contextual Predictive Checking:** The Rust engine uses Tree-sitter to identify "incomplete" structural blocks (e.g., an unclosed parenthesis or a missing required LaTeX command argument) and suggests the completion inline as ghost text.

---

## 14. License Compliance & Open Source Attribution

To ensure the "Ultimate Extension" is legally sound and respects its dependencies, we implement automated license management from the start.

### 14.1 Automated License Auditing
We use industry-standard tools to prevent "license creep" and ensure no incompatible licenses (like GPL-3.0 in a non-GPL project) are introduced.
* **Rust:** Use `cargo-deny` to enforce a whitelist of allowed licenses (e.g., MIT, Apache-2.0, BSD-3-Clause). It will fail the build if a dependency uses a prohibited license.
* **TypeScript:** Use `pnpm audit --json` or a compatible `pnpm` license checker to audit `node_modules` and generate a summary of all third-party licenses.

### 14.2 Known Core Licenses
*   **Harper (`harper-core`):** Apache-2.0. (Permissive, requires attribution).
*   **LanguageTool:** LGPL-2.1 or later. Since we connect via **HTTP Bridge**, we are "using" the tool rather than "linking" to it, which simplifies compliance, but we must still provide attribution.
*   **Tree-sitter:** MIT. (Permissive, requires attribution).
*   **Protobuf (Prost/Protobufjs):** Apache-2.0 / BSD-3-Clause.

### 14.3 Automated Attribution Generation
We maintain a `THIRD_PARTY_NOTICES.md` file in the repository.
* **Generation Script:** A custom Rust/TS script that aggregates the `LICENSE` files from all dependencies into a single, user-readable document.
* **Dashboard Integration:** The "Inspector" dashboard will include an "About & Credits" section that dynamically loads these notices, ensuring users can always see the open-source giants whose shoulders we stand on.

---

## 15. Scaling, Accessibility & Community Growth

To truly become the "Ultimate" extension, we must address how the tool behaves in massive professional environments and how it invites community contributions.

### 15.1 Monorepo Scalability (LRU Caching)
Large workspaces (10,000+ files) can overwhelm even Rust engines if not handled carefully.
*   **AST Cache:** The Orchestrator maintains an **LRU (Least Recently Used) Cache** for Tree-sitter ASTs and Prose Streams. Only active and recently touched files stay in memory.
*   **Background Indexing:** Initial workspace scans are low-priority background tasks that yield to active editor keystrokes.

### 15.2 Project-Level Configuration (`.languagecheck.yaml`)
To ensure team-wide consistency, the extension prioritizes project-root configuration files over user-level VS Code settings.
*   **Shared Dictionaries:** Teams can check in `.languagecheck/dictionary.txt` to the repo.
*   **Rule Overrides:** Specific grammar rules can be toggled per-directory within the YAML config.

### 15.3 Accessibility (a11y) & Internationalization (i18n)
*   **Screen Reader Support:** The Svelte-based SpeedFix UI will use semantic HTML and ARIA labels, ensuring the keyboard-driven workflow is fully accessible to visually impaired developers.
*   **Localized Diagnostics:** While checkers (like Harper) analyze specific languages, the *interface* of the extension (menus, error descriptions) will support i18n to reach a global audience.

### 15.4 Anonymous Feedback & Learning Loop
*   **Refinement Metrics:** If a user consistently ignores a specific "Grammar Rule" across a project, the extension can locally suggest disabling that rule.
*   **Engine Improvement:** Users can optionally "Submit as False Positive," which packages the anonymized prose snippet and the offending rule for engine maintainers to analyze.

### 15.5 The "First Run" Experience
*   **Onboarding Tour:** A lightweight walkthrough when the extension is first installed, explaining the **SpeedFix** shortcut (`Alt+F` by default) and the **Status Bar** language switcher.

---

## 16. Standalone CLI Utility

Beyond the VS Code extension, a standalone Command Line Interface (CLI) utility will be provided. This allows power users, CI/CD pipelines, and automated scripts to leverage the full power of the core language checking engine without requiring VS Code.

*   **Core Re-use:** The CLI will directly link and utilize the exact same Rust core logic, ensuring consistency in diagnostics and performance with the VS Code extension.
*   **Rich & User-Friendly Output:**
    *   **Argument Parsing:** Uses **Clap** for robust, declarative command-line argument parsing.
    *   **Styled Output:** Integrates rich output libraries like **Console** and **Indicatif** to provide colored, formatted, and easily readable output, similar to Python's `Typer` or other modern CLI tools. This enhances user experience by making errors and suggestions clear and actionable directly in the terminal.
*   **Key Features:**
    *   `language-check check <file/dir>`: Scan specified files or an entire directory.
    *   `language-check fix <file/dir>`: Apply auto-fixes (if enabled and safe).
    *   `language-check config`: Inspect or generate configuration files.
    *   `language-check list-rules`: Display available grammar rules and plugins.
    *   `language-check --format=json`: Output diagnostics in machine-readable JSON for scripting.
*   **CI/CD Integration:** Easily embeddable into build scripts to enforce prose quality gates before commits or merges.
*   **Late-Stage Publishing to Package Registries:** As the project matures, the Rust core CLI will be published to various system-level package registries to simplify installation and updates for a broader audience. Target registries include:
    *   **crates.io:** The official Rust package registry.
    *   **Homebrew:** For macOS users.
    *   **winget:** For Windows users.
    *   **Linux Package Managers:** Integration with `apt`, `dnf`, or `pacman` via community package maintainers or automated processes.

---

## 17. Implementation Checklist

### Phase 1: The Rust Core (Binary Protobuf Server)
- [ ] Initialize project with `prost` and `ropey`.
- [ ] Implement Tree-sitter AST Traversal & SLS Meta-Parser.
- [ ] Set up `divan` benchmarking.
- [ ] Implement binary message framing over stdio/sockets.

### Phase 2: VS Code Foundation
- [ ] TS Extension with `protobufjs` and strict linting.
- [ ] **Workflow:** Set up `Lefthook` for pre-push hooks.
- [ ] Status Bar & Core Switcher logic.
- [ ] "Inspector" Dashboard scaffold (Svelte).

### Phase 3: The Ignore & Plugin Engine
- [ ] **Structural Hashing** implementation in Rust.
- [ ] **Extism** WASM plugin integration.
- [ ] YAML rule engine.

### Phase 4: SpeedFix UI
- [ ] **Svelte + Vite + Tailwind** Webview.
- [ ] **Vitest + Playwright** isolated testing.
-   **Styling Hygiene:** Centralized `@apply` classes and design tokens.
- [ ] Batch `WorkspaceEdit` application.

### Phase 5: Polish & CI/CD
- [ ] **Harper** & **LanguageTool Fallback**.
- [ ] **CI Pipeline:** Set up GitHub Actions for cross-platform testing and license auditing.
- [ ] **Continuous Benchmarking:** Integrate `bencher.dev` or `criterion-compare-action`.
- [ ] **CD Pipeline:** Automated VSIX bundling and marketplace publishing.
- [ ] **Localized Documentation:** Setup localized Sphinx portal.
- [ ] Publish!

---

## 18. References & Resources

### Local Reference Implementations
* **Forester SpeedFix:** `/home/as_user/Projects/forester-lang-support/src/speedfix.ts` (Keyboard-driven resolution UI)
* **LTeX+ Language Server:** `refs/ltex-ls-plus/` (LSP implementation for LanguageTool)
* **LanguageTool Server:** `refs/languagetool-languageserver/` (Basic Java-based LSP wrapper)

### Core Technologies
* **[Harper (Primary Engine)](https://github.com/Automattic/harper):** Native Rust grammar checker for developers.
* **[LanguageTool (Fallback Engine)](https://languagetool.org/):** Multi-language grammar checker.
* **[Tree-sitter](https://tree-sitter.github.io/tree-sitter/):** Incremental parsing for markup-agnosticism.
* **[Extism](https://extism.org/):** WebAssembly plugin system for the orchestrator.
* **[Prost](https://github.com/tokio-rs/prost):** Protocol Buffers implementation for Rust.
* **[protobufjs](https://github.com/protobufjs/protobuf.js):** Protocol Buffers for the TypeScript client.

### Performance & Quality Tooling
* **[Divan](https://github.com/nvzqz/divan):** Statistically-comfy benchmarking for Rust.
* **[Bencher](https://bencher.dev/):** Continuous Benchmarking for CI.
* **[Vitest](https://vitest.dev/):** Vite-native testing framework with Playwright browser mode.
* **[Tailwind CSS](https://tailwindcss.com/):** Utility-first CSS for theme-aware Webviews.

### Inspiration & Ecosystem
* **[Typos](https://github.com/crate-ci/typos):** Source code spell checker (inspiration for speed/low false positives).
* **[Vale](https://vale.sh/):** Prose linter for style guides (inspiration for the YAML rule engine).
* **[CSpell](https://cspell.org/):** Code-aware spell checker for TypeScript/VS Code.

---

## 19. Summary & Conclusion

By pivoting away from the JVM and Regex, and moving towards **Rust and Tree-sitter**, we eliminate the performance and consistency bottlenecks of LTeX. By taking inspiration from Forester's **SpeedFix**, we solve the UX nightmare of resolving hundreds of spelling mistakes. This architecture is not just an incremental improvement; it is the foundation for the definitive, ultimate language tooling ecosystem for modern developers.
