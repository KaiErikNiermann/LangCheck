use std::collections::HashMap;

use crate::config::Config;

/// Built-in file extension → canonical language ID mappings.
/// These are always available without any configuration.
const BUILTIN_EXTENSIONS: &[(&str, &str)] = &[
    ("md", "markdown"),
    ("markdown", "markdown"),
    ("html", "html"),
    ("htm", "html"),
    ("xhtml", "html"),
    ("tex", "latex"),
    ("latex", "latex"),
    ("ltx", "latex"),
    ("tree", "forester"),
    ("tiny", "tinylang"),
    ("rst", "rst"),
    ("rest", "rst"),
    ("Rnw", "sweave"),
    ("rnw", "sweave"),
    ("bib", "bibtex"),
    ("org", "org"),
];

/// Language ID aliases: VS Code may send these as `language_id`,
/// and we resolve them to a canonical ID that has a tree-sitter grammar
/// and prose extractor.
const LANGUAGE_ID_ALIASES: &[(&str, &str)] = &[("mdx", "markdown"), ("xhtml", "html")];

/// The set of canonical language IDs with built-in tree-sitter support.
pub const SUPPORTED_LANGUAGE_IDS: &[&str] = &[
    "markdown", "html", "latex", "forester", "tinylang", "rst", "sweave", "bibtex", "org",
];

/// Look up the built-in canonical language ID for a file extension.
#[must_use]
pub fn builtin_language_for_extension(ext: &str) -> Option<&'static str> {
    BUILTIN_EXTENSIONS
        .iter()
        .find_map(|&(builtin_ext, lang_id)| {
            builtin_ext.eq_ignore_ascii_case(ext).then_some(lang_id)
        })
}

/// Detect the canonical language ID for a file path based on its extension.
///
/// Checks user-defined aliases from config first, then built-in mappings.
/// Returns `"markdown"` as the default when no match is found.
#[must_use]
pub fn detect_language(path: &std::path::Path, config: &Config) -> String {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return "markdown".to_string();
    };

    // User-defined aliases take priority
    for (lang_id, extensions) in &config.languages.extensions {
        if extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
            return resolve_language_id(lang_id).to_string();
        }
    }

    // Built-in mappings
    if let Some(lang_id) = builtin_language_for_extension(ext) {
        return lang_id.to_string();
    }

    "markdown".to_string()
}

/// Resolve a language ID to its canonical form.
///
/// Handles aliases like `"mdx"` → `"markdown"`, `"xhtml"` → `"html"`.
/// Returns the input unchanged if it's already canonical or unknown.
#[must_use]
pub fn resolve_language_id(lang_id: &str) -> &str {
    for &(alias, canonical) in LANGUAGE_ID_ALIASES {
        if alias.eq_ignore_ascii_case(lang_id) {
            return canonical;
        }
    }
    lang_id
}

/// Get all file extensions (without leading dots) for a given canonical language ID.
///
/// Combines built-in extensions with any user-defined aliases from config.
#[must_use]
pub fn extensions_for_language(lang_id: &str, config: &Config) -> Vec<String> {
    let mut exts: Vec<String> = BUILTIN_EXTENSIONS
        .iter()
        .filter(|&&(_, lid)| lid == lang_id)
        .map(|&(ext, _)| ext.to_string())
        .collect();

    if let Some(extras) = config.languages.extensions.get(lang_id) {
        for e in extras {
            if !exts.iter().any(|existing| existing.eq_ignore_ascii_case(e)) {
                exts.push(e.clone());
            }
        }
    }

    exts
}

/// Get all `(glob_pattern, canonical_language_id)` pairs for workspace scanning.
///
/// Returns one entry per file extension, e.g. `("**/*.md", "markdown")`.
#[must_use]
pub fn all_file_patterns(config: &Config) -> Vec<(String, String)> {
    let mut seen: HashMap<String, String> = HashMap::new();

    // Built-in patterns
    for &(ext, lang_id) in BUILTIN_EXTENSIONS {
        seen.entry(ext.to_string())
            .or_insert_with(|| lang_id.to_string());
    }

    // User-defined patterns
    for (lang_id, extensions) in &config.languages.extensions {
        let canonical = resolve_language_id(lang_id).to_string();
        for ext in extensions {
            seen.entry(ext.to_lowercase())
                .or_insert_with(|| canonical.clone());
        }
    }

    seen.into_iter()
        .map(|(ext, lang)| (format!("**/*.{ext}"), lang))
        .collect()
}

/// Get all language IDs that the extension should register for,
/// including aliases that VS Code might send.
#[must_use]
pub fn all_activation_language_ids(config: &Config) -> Vec<String> {
    let mut ids: Vec<String> = SUPPORTED_LANGUAGE_IDS
        .iter()
        .map(|s| (*s).to_string())
        .collect();

    // Add known VS Code language ID aliases
    for &(alias, _) in LANGUAGE_ID_ALIASES {
        if !ids.contains(&alias.to_string()) {
            ids.push(alias.to_string());
        }
    }

    // Add any custom aliases from config (the keys themselves)
    for lang_id in config.languages.extensions.keys() {
        let canonical = resolve_language_id(lang_id);
        // If the key is different from canonical, it's an alias VS Code might send
        if lang_id != canonical && !ids.contains(lang_id) {
            ids.push(lang_id.clone());
        }
    }

    ids
}

/// Resolve a canonical language ID to its tree-sitter [`Language`](tree_sitter::Language).
///
/// Falls back to Markdown for unknown language IDs.
#[must_use]
pub fn resolve_ts_language(lang: &str) -> tree_sitter::Language {
    match lang {
        "html" => tree_sitter_html::LANGUAGE.into(),
        "latex" | "sweave" => codebook_tree_sitter_latex::LANGUAGE.into(),
        "forester" => crate::forester_ts::LANGUAGE.into(),
        "tinylang" => crate::tinylang_ts::LANGUAGE.into(),
        "rst" => tree_sitter_rst::LANGUAGE.into(),
        "bibtex" => crate::bibtex_ts::LANGUAGE.into(),
        "org" => crate::org_ts::LANGUAGE.into(),
        _ => tree_sitter_md::LANGUAGE.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn default_config() -> Config {
        Config::default()
    }

    #[test]
    fn detect_builtin_markdown() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("README.md"), &config), "markdown");
    }

    #[test]
    fn builtin_language_for_extension_matches_case_insensitively() {
        assert_eq!(builtin_language_for_extension("HTML"), Some("html"));
        assert_eq!(builtin_language_for_extension("unknown"), None);
    }

    #[test]
    fn detect_builtin_html_variants() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("page.html"), &config), "html");
        assert_eq!(detect_language(Path::new("page.htm"), &config), "html");
    }

    #[test]
    fn detect_builtin_latex_variants() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("paper.tex"), &config), "latex");
        assert_eq!(detect_language(Path::new("paper.latex"), &config), "latex");
        assert_eq!(detect_language(Path::new("paper.ltx"), &config), "latex");
    }

    #[test]
    fn detect_builtin_forester() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("doc.tree"), &config), "forester");
    }

    #[test]
    fn detect_unknown_defaults_to_markdown() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("notes.txt"), &config), "markdown");
        assert_eq!(detect_language(Path::new("no_ext"), &config), "markdown");
    }

    #[test]
    fn detect_user_alias() {
        let mut config = default_config();
        config
            .languages
            .extensions
            .insert("markdown".to_string(), vec!["mdx".to_string()]);
        assert_eq!(detect_language(Path::new("page.mdx"), &config), "markdown");
    }

    #[test]
    fn user_alias_takes_priority() {
        let mut config = default_config();
        // Map .md to html (weird but tests priority)
        config
            .languages
            .extensions
            .insert("html".to_string(), vec!["md".to_string()]);
        assert_eq!(detect_language(Path::new("README.md"), &config), "html");
    }

    #[test]
    fn resolve_known_alias() {
        assert_eq!(resolve_language_id("mdx"), "markdown");
        assert_eq!(resolve_language_id("xhtml"), "html");
    }

    #[test]
    fn resolve_canonical_unchanged() {
        assert_eq!(resolve_language_id("markdown"), "markdown");
        assert_eq!(resolve_language_id("html"), "html");
        assert_eq!(resolve_language_id("latex"), "latex");
        assert_eq!(resolve_language_id("forester"), "forester");
    }

    #[test]
    fn resolve_unknown_unchanged() {
        assert_eq!(resolve_language_id("python"), "python");
    }

    #[test]
    fn extensions_for_markdown() {
        let config = default_config();
        let exts = extensions_for_language("markdown", &config);
        assert!(exts.contains(&"md".to_string()));
        assert!(exts.contains(&"markdown".to_string()));
    }

    #[test]
    fn extensions_with_user_additions() {
        let mut config = default_config();
        config
            .languages
            .extensions
            .insert("markdown".to_string(), vec!["mdx".to_string()]);
        let exts = extensions_for_language("markdown", &config);
        assert!(exts.contains(&"md".to_string()));
        assert!(exts.contains(&"mdx".to_string()));
    }

    #[test]
    fn all_file_patterns_includes_builtins() {
        let config = default_config();
        let patterns = all_file_patterns(&config);
        assert!(
            patterns
                .iter()
                .any(|(p, l)| p == "**/*.md" && l == "markdown")
        );
        assert!(
            patterns
                .iter()
                .any(|(p, l)| p == "**/*.html" && l == "html")
        );
        assert!(
            patterns
                .iter()
                .any(|(p, l)| p == "**/*.tex" && l == "latex")
        );
        assert!(
            patterns
                .iter()
                .any(|(p, l)| p == "**/*.tree" && l == "forester")
        );
    }

    #[test]
    fn all_file_patterns_includes_user_aliases() {
        let mut config = default_config();
        config
            .languages
            .extensions
            .insert("markdown".to_string(), vec!["mdx".to_string()]);
        let patterns = all_file_patterns(&config);
        assert!(
            patterns
                .iter()
                .any(|(p, l)| p == "**/*.mdx" && l == "markdown")
        );
    }

    #[test]
    fn case_insensitive_extension_detection() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("page.HTML"), &config), "html");
        assert_eq!(detect_language(Path::new("paper.TEX"), &config), "latex");
    }

    #[test]
    fn language_config_from_yaml() {
        let yaml = r#"
languages:
  extensions:
    markdown:
      - mdx
      - Rmd
    latex:
      - sty
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(detect_language(Path::new("page.mdx"), &config), "markdown");
        assert_eq!(
            detect_language(Path::new("analysis.Rmd"), &config),
            "markdown"
        );
        assert_eq!(detect_language(Path::new("style.sty"), &config), "latex");
    }

    #[test]
    fn detect_builtin_sweave() {
        let config = default_config();
        assert_eq!(
            detect_language(Path::new("analysis.Rnw"), &config),
            "sweave"
        );
        assert_eq!(
            detect_language(Path::new("analysis.rnw"), &config),
            "sweave"
        );
    }

    #[test]
    fn resolve_sweave_unchanged() {
        // sweave is its own canonical ID, not an alias
        assert_eq!(resolve_language_id("sweave"), "sweave");
    }

    #[test]
    fn sweave_in_supported_language_ids() {
        assert!(
            SUPPORTED_LANGUAGE_IDS.contains(&"sweave"),
            "sweave should be in SUPPORTED_LANGUAGE_IDS"
        );
    }

    #[test]
    fn detect_builtin_bibtex() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("refs.bib"), &config), "bibtex");
    }

    #[test]
    fn bibtex_in_supported_language_ids() {
        assert!(
            SUPPORTED_LANGUAGE_IDS.contains(&"bibtex"),
            "bibtex should be in SUPPORTED_LANGUAGE_IDS"
        );
    }

    #[test]
    fn detect_builtin_org() {
        let config = default_config();
        assert_eq!(detect_language(Path::new("notes.org"), &config), "org");
    }

    #[test]
    fn org_in_supported_language_ids() {
        assert!(
            SUPPORTED_LANGUAGE_IDS.contains(&"org"),
            "org should be in SUPPORTED_LANGUAGE_IDS"
        );
    }
}
