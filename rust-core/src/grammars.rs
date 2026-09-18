//! Bindings to the tree-sitter grammars vendored under `tree-sitter-*/`.
//!
//! `build.rs` compiles each grammar's `parser.c` into a static library that
//! exposes one `tree_sitter_<name>` entry point; these are the Rust-side
//! declarations of those symbols. The grammars that come from crates.io
//! (Markdown, HTML, LaTeX, reStructuredText) need none of this and are used
//! directly — see [`crate::languages::resolve_ts_language`].

use tree_sitter_language::LanguageFn;

/// Declare a vendored grammar's `extern "C"` entry point and the `LanguageFn`
/// that wraps it.
///
/// The declaration is identical for every grammar down to the symbol name, so
/// it lives here once instead of in a file per language.
macro_rules! vendored_grammars {
    ($($konst:ident => $symbol:ident),+ $(,)?) => {
        unsafe extern "C" {
            $(fn $symbol() -> *const ();)+
        }

        $(
            #[doc = concat!("The vendored `", stringify!($symbol), "` grammar.")]
            // SAFETY: `$symbol` is the entry point `build.rs` compiled from this
            // grammar's `parser.c`, which returns a `&'static TSLanguage` built
            // by tree-sitter's own generator — exactly what `from_raw` expects.
            pub const $konst: LanguageFn = unsafe { LanguageFn::from_raw($symbol) };
        )+
    };
}

vendored_grammars! {
    BIBTEX => tree_sitter_bibtex,
    FORESTER => tree_sitter_forester,
    ORG => tree_sitter_org,
    TINYLANG => tree_sitter_tinylang,
    TYPST => tree_sitter_typst,
}
