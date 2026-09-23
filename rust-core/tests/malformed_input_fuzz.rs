//! Randomised robustness test: malformed documents through the whole
//! extraction pipeline, in every grammar.
//!
//! `prose_composition_fuzz.rs` composes *valid* documents and checks what is
//! extracted. This one checks only that nothing breaks, over documents no
//! parser was meant to read: token soup from each language's own syntax,
//! absurdly long runs of one token (nesting a thousand deep), text cut off
//! mid-construct, and characters that trip byte arithmetic. Each document
//! goes through `extract_with_range_limit` at several split sizes, and a
//! share of them on through Harper, and every range, exclusion and
//! diagnostic has to land in bounds and on a character boundary.
//!
//! Both bugs this was written after were of that kind: a split that sliced
//! through a four-byte character, and a Markdown nesting depth that made
//! tree-sitter abort the process. An abort cannot be caught, so before each
//! case its seed is written to `target/malformed-fuzz-last-case-<lang>.txt`; after
//! a crash, that file names the case to rerun with `MALFORMED_FUZZ_SEED`,
//! and `MALFORMED_FUZZ_DUMP=<path>` writes that case's document out.
//!
//! `MALFORMED_FUZZ_ITERATIONS` sets the cases per language (default 200, a
//! few seconds). A case slower than `MALFORMED_FUZZ_SLOW_MS` (default 5000)
//! fails too. Run a long pass under memguard, since a pathological case
//! can take a lot of memory:
//!
//! ```sh
//! MALFORMED_FUZZ_ITERATIONS=20000 memguard run -t 85 -- \
//!     cargo test --release --test malformed_input_fuzz
//! ```

use std::fmt::Write as _;
use std::path::PathBuf;

use lang_check::engines::{Engine, HarperEngine};
use lang_check::prose::{ProseRange, extract_with_range_limit, latex::LatexExtras};
use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};

/// Each language's own delimiters, the material a malformed document of that
/// kind is made of.
fn alphabet(lang: &str) -> &'static [&'static str] {
    match lang {
        "markdown" => &[
            "# ",
            "## ",
            "> ",
            "- ",
            "* ",
            "1. ",
            "```",
            "```rust\n",
            "~~~",
            "[",
            "](",
            ")",
            "![",
            "`",
            "**",
            "_",
            "<div>",
            "</div>",
            "<!--",
            "-->",
            "|",
            "---\n",
            "$",
            "$$",
            "\\",
            "[^1]",
            "    ",
            "\t",
        ],
        "latex" | "sweave" => &[
            "\\begin{itemize}",
            "\\end{itemize}",
            "\\begin{equation}",
            "\\end{equation}",
            "{",
            "}",
            "$",
            "$$",
            "\\[",
            "\\]",
            "%",
            "\\item ",
            "\\verb|",
            "\\section{",
            "\\textbf{",
            "\\emph{",
            "&",
            "\\\\",
            "\\begin{verbatim}",
            "\\end{verbatim}",
            "<<>>=\n",
            "\n@\n",
            "\\Sexpr{",
        ],
        "html" => &[
            "<p>",
            "</p>",
            "<div>",
            "</div>",
            "<!--",
            "-->",
            "<script>",
            "</script>",
            "<pre>",
            "</pre>",
            "<style>",
            "&amp;",
            "&#x1F600;",
            "<",
            ">",
            "\"",
            "<a href=\"",
            "<br/>",
            "<![CDATA[",
            "]]>",
        ],
        "typst" => &[
            "#",
            "[",
            "]",
            "(",
            ")",
            "$",
            "= ",
            "== ",
            "//",
            "/*",
            "*/",
            "#let x = ",
            "\"",
            "#set text(lang: \"de\")",
            "#emph[",
            "*",
            "_",
            "`",
            "```",
            "#{",
            "}",
            "<label>",
            "@ref",
        ],
        "org" => &[
            "* ",
            "** ",
            "#+begin_src rust\n",
            "#+end_src\n",
            "#+BEGIN_QUOTE\n",
            ":PROPERTIES:\n",
            ":END:\n",
            "[[",
            "]]",
            "=",
            "~",
            "/",
            "+",
            "- [ ] ",
            "#+TITLE: ",
            "| ",
        ],
        "rst" => &[
            ".. ",
            "::\n",
            "====\n",
            "----\n",
            "`",
            "``",
            "|",
            ".. code-block:: rust\n",
            ".. note::\n",
            "   ",
            "* ",
            "#. ",
            ":ref:`",
            "`_",
            "__",
            ".. |sub| replace:: ",
        ],
        "bibtex" => &[
            "@article{",
            "@book{",
            "}",
            "{",
            "title = {",
            "author = \"",
            "\"",
            ",",
            "=",
            "@comment{",
            "%",
        ],
        "forester" => &[
            "\\title{",
            "\\p{",
            "}",
            "{",
            "#{",
            "##{",
            "\\ul{",
            "\\li{",
            "\\import{",
            "\\def\\x{",
            "%",
        ],
        _ => &[
            "{", "}", "(", ")", "[", "]", "#", "\"", "'", "<", ">", "/", "*",
        ],
    }
}

/// Characters that trip byte and character arithmetic, escaped so none of
/// them sits in this file raw.
const ODDITIES: &[&str] = &[
    "\u{0}",
    "\u{7}",
    "\u{200b}",
    "\u{200d}",
    "\u{202e}",
    "e\u{301}\u{302}",
    "\u{1f469}\u{200d}\u{1f467}",
    "\u{1d518}\u{1d52b}",
    "\u{645}\u{631}\u{62d}\u{628}\u{627}",
    "\u{5e9}\u{5dc}",
    "\u{feff}",
    "\u{4e2d}\u{6587}",
    "\r",
    "\r\n",
    "\u{2028}",
    "\u{fffd}",
];

const WORDS: &[&str] = &[
    "the",
    "checker",
    "reads",
    "prose",
    "and",
    "recieve",
    "teh",
    "seperate",
    "lang:",
    "fr",
    "lang-check-begin",
    "lang-check-end",
    "lang-check-ignore",
    "<!-- lang: de -->",
    "% lang: fr",
    "// @lang: es",
];

fn document(rng: &mut SmallRng, lang: &str) -> String {
    let alphabet = alphabet(lang);
    let mut out = String::new();
    if rng.random_bool(0.05) {
        out.push('\u{feff}');
    }
    for _ in 0..rng.random_range(1..300) {
        let roll = rng.random_range(0..100);
        let token = match roll {
            0..40 => alphabet[rng.random_range(0..alphabet.len())],
            40..75 => WORDS[rng.random_range(0..WORDS.len())],
            75..88 => ODDITIES[rng.random_range(0..ODDITIES.len())],
            88..95 => "\n",
            _ => " ",
        };
        // Now and then a long run of one token: nesting far past what any
        // document writes, which is where fixed-size parser state gives out.
        let times = if rng.random_bool(0.03) {
            rng.random_range(50..1200)
        } else {
            1
        };
        for _ in 0..times {
            out.push_str(token);
        }
        if roll < 75 && rng.random_bool(0.6) {
            out.push(' ');
        }
    }
    // Cut off mid-construct, on a character boundary.
    if rng.random_bool(0.3) && !out.is_empty() {
        let cut = out.floor_char_boundary(rng.random_range(0..out.len()));
        out.truncate(cut);
    }
    out
}

/// What must hold of any extraction, however broken its input.
fn check_ranges(text: &str, ranges: &[ProseRange], context: &str) {
    for range in ranges {
        let what = || format!("{context}: range {}..{}", range.start_byte, range.end_byte);
        assert!(
            range.start_byte <= range.end_byte && range.end_byte <= text.len(),
            "{} out of bounds",
            what()
        );
        assert!(
            text.is_char_boundary(range.start_byte) && text.is_char_boundary(range.end_byte),
            "{} is not on character boundaries",
            what()
        );
        let mut previous_end = range.start_byte;
        for &(start, end) in &range.exclusions {
            assert!(
                start <= end,
                "{}: exclusion {start}..{end} is reversed",
                what()
            );
            assert!(
                start >= previous_end && end <= range.end_byte,
                "{}: exclusion {start}..{end} out of place",
                what()
            );
            previous_end = end;
        }
        if let Some((start, end)) = range.language_span {
            assert!(
                start <= end && end <= text.len(),
                "{}: language span {start}..{end} out of bounds",
                what()
            );
        }
    }
}

/// One per language: the tests run on parallel threads, and a shared file
/// would name whichever case wrote last rather than the one that crashed.
fn last_case_file(lang: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("malformed-fuzz-last-case-{lang}.txt"))
}

fn iterations() -> u64 {
    std::env::var("MALFORMED_FUZZ_ITERATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(200)
}

/// Every case for `lang`, or the one `MALFORMED_FUZZ_SEED` names.
fn seeds(lang: &str) -> Vec<u64> {
    let base = lang.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)
    });
    match std::env::var("MALFORMED_FUZZ_SEED")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        Some(seed) => vec![seed],
        None => (0..iterations()).map(|i| base.wrapping_add(i)).collect(),
    }
}

/// How long one case may take, all its split sizes together. A case over it
/// is a bug of its own: a document a few kilobytes long that takes seconds to
/// read is quadratic somewhere, and a longer one is quadratic enough to hang
/// the editor.
fn slow_ms() -> u128 {
    std::env::var("MALFORMED_FUZZ_SLOW_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5_000)
}

fn fuzz_extraction(lang: &str) {
    let extras = LatexExtras::default();
    for seed in seeds(lang) {
        let started = std::time::Instant::now();
        std::fs::write(
            last_case_file(lang),
            format!("lang={lang} MALFORMED_FUZZ_SEED={seed}\n"),
        )
        .ok();
        let mut rng = SmallRng::seed_from_u64(seed);
        let text = document(&mut rng, lang);
        // With MALFORMED_FUZZ_SEED, the document itself, to look at.
        if let Ok(path) = std::env::var("MALFORMED_FUZZ_DUMP") {
            std::fs::write(path, &text).ok();
        }
        for limit in [0, 7, 64, 4096] {
            let context = format!("{lang} seed {seed} limit {limit}");
            // A parse that fails is an error the caller handles; only a panic
            // or a broken range is a bug.
            if let Ok(extraction) =
                extract_with_range_limit(&text, lang, None, None, &extras, limit)
            {
                check_ranges(&text, &extraction.ranges, &context);
            }
        }
        let took = started.elapsed().as_millis();
        assert!(
            took <= slow_ms(),
            "{lang} seed {seed}: {took}ms for a {}-byte document (MALFORMED_FUZZ_SLOW_MS={})",
            text.len(),
            slow_ms()
        );
    }
}

macro_rules! extraction_fuzz {
    ($($name:ident => $lang:literal),* $(,)?) => {
        $(
            #[test]
            fn $name() {
                fuzz_extraction($lang);
            }
        )*
    };
}

extraction_fuzz! {
    malformed_markdown => "markdown",
    malformed_latex => "latex",
    malformed_sweave => "sweave",
    malformed_html => "html",
    malformed_typst => "typst",
    malformed_org => "org",
    malformed_rst => "rst",
    malformed_bibtex => "bibtex",
    malformed_forester => "forester",
    malformed_tinylang => "tinylang",
    malformed_unknown_language => "no-such-language",
}

/// Harper over what extraction produced: its diagnostics are byte offsets
/// into the checked text, and a wrong one lands a squiggle mid-character.
#[tokio::test]
async fn harper_diagnostics_stay_in_bounds_on_malformed_prose() {
    let extras = LatexExtras::default();
    let mut engine = HarperEngine::new(&lang_check::config::HarperConfig::default());
    for lang in ["markdown", "latex", "html", "typst"] {
        // A tenth of the extraction cases: a check costs far more than a parse.
        for seed in seeds(lang).into_iter().step_by(10) {
            std::fs::write(
                last_case_file(&format!("harper-{lang}")),
                format!("lang={lang} MALFORMED_FUZZ_SEED={seed} (the Harper test)\n"),
            )
            .ok();
            let mut rng = SmallRng::seed_from_u64(seed);
            let text = document(&mut rng, lang);
            let Ok(extraction) = extract_with_range_limit(&text, lang, None, None, &extras, 4096)
            else {
                continue;
            };
            for range in &extraction.ranges {
                let checked = range.extract_text(&text);
                let mut context = String::new();
                let _ = write!(
                    context,
                    "{lang} seed {seed} range {}..{}",
                    range.start_byte, range.end_byte
                );
                let Ok(diagnostics) = engine.check(&checked, "en-US").await else {
                    continue;
                };
                for d in diagnostics {
                    let (start, end) = (d.start_byte as usize, d.end_byte as usize);
                    assert!(
                        start <= end && end <= checked.len(),
                        "{context}: diagnostic {start}..{end} out of bounds"
                    );
                    assert!(
                        checked.is_char_boundary(start) && checked.is_char_boundary(end),
                        "{context}: diagnostic {start}..{end} not on character boundaries"
                    );
                }
            }
        }
    }
}
