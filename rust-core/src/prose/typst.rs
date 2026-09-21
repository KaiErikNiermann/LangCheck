use tree_sitter::Node;

use super::ProseRange;
use super::shared::child_of_kind;

/// Node types whose own text is never prose.
///
/// Skipping one does not skip the content blocks (`[...]`) nested inside it:
/// `#columns(2)[...]`, `#align(center)[...]` and every other call that wraps
/// markup parses as a `code` node, and the markup in those brackets is prose.
/// See [`collect_nested_content`]; the kinds that are opaque all the way down
/// are listed in [`OPAQUE_NODES`].
const SKIP_NODES: &[&str] = &[
    "raw_blck",  // ```code blocks```
    "raw_span",  // `inline code`
    "math",      // $math$ and $ display math $
    "code",      // #code expressions
    "comment",   // // and /* */ comments
    "set",       // set rules
    "show",      // show rules
    "let",       // let bindings
    "import",    // import statements
    "include",   // include statements
    "label",     // <label>
    "ref",       // @reference
    "url",       // https://...
    "escape",    // \n, \u{...}
    "linebreak", // \  (trailing backslash)
];

/// Skipped node types that hold no prose at any depth.
///
/// Unlike the rest of [`SKIP_NODES`], these are not searched for nested
/// content blocks — a `[...]` inside raw text, a comment or a formula is part
/// of that construct, not markup to check.
const OPAQUE_NODES: &[&str] = &[
    "raw_blck",
    "raw_span",
    "math",
    "comment",
    "label",
    "ref",
    "url",
    "escape",
    "linebreak",
];

/// Extract prose ranges from a Typst AST.
///
/// Collects text from paragraphs, headings, and list items while
/// skipping code blocks, math, set/show rules, imports, and other
/// non-prose elements. Inline markup (emphasis, strong) is bridged.
pub fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut ranges = Vec::new();
    collect_prose(root, text, &mut ranges, None);
    ranges
}

/// Recursively collect prose ranges from the AST.
///
/// `lang` is the natural language in force here, from the nearest enclosing
/// `#set text(lang: …)` or `#text(lang: …)[…]`. Typst scopes both lexically,
/// so it is threaded down the walk and reset by each content block that
/// declares its own.
fn collect_prose(node: Node, text: &str, out: &mut Vec<ProseRange>, lang: Option<&Declared>) {
    let kind = node.kind();

    if SKIP_NODES.contains(&kind) {
        if !OPAQUE_NODES.contains(&kind) {
            collect_nested_content(node, text, out, lang);
        }
        return;
    }

    // Text leaf nodes are the primary prose content
    if kind == "text" {
        let start = node.start_byte();
        let end = node.end_byte();
        if start < end {
            // Try to merge with the previous range if they're on the same line
            // or adjacent (bridging through inline markup)
            // Only bridge into a range written in the same language, or the
            // two halves would be checked as one under whichever came first.
            if let Some(last) = out.last_mut()
                && last.language.as_deref() == lang.map(|d| d.tag.as_str())
            {
                let gap = &text[last.end_byte..start];
                if is_bridgeable(gap) {
                    exclude_markup(text, last.end_byte, start, &mut last.exclusions);
                    last.end_byte = end;
                    return;
                }
            }
            out.push(ProseRange {
                start_byte: start,
                end_byte: end,
                exclusions: Vec::new(),
                language: lang.map(|d| d.tag.clone()),
                language_span: lang.map(|d| d.span),
            });
        }
        return;
    }

    // Heading text: extract the text content, skip the # markers
    if kind == "heading" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "text" || child.kind() == "emph" || child.kind() == "strong" {
                collect_prose(child, text, out, lang);
            }
        }
        return;
    }

    // Recurse into children for container nodes. A `#set text(lang: …)` applies
    // to its later siblings, so the walk carries it forward from where it sits.
    let mut declared: Option<Declared> = None;
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = set_rule_language(child, text) {
            declared = Some(found);
        }
        collect_prose(child, text, out, declared.as_ref().or(lang));
    }
}

/// Collect prose from content blocks nested inside a skipped code subtree.
///
/// A call such as `#figure(caption: [A caption.])[Body text.]` parses as
/// `code -> call -> (ident, group, content)`, so the prose only becomes
/// reachable by descending past the skipped `code` node. Everything that is
/// not a content block — idents, numbers, strings, argument names — stays
/// skipped, and [`OPAQUE_NODES`] subtrees are not descended into at all.
fn collect_nested_content(
    node: Node,
    text: &str,
    out: &mut Vec<ProseRange>,
    lang: Option<&Declared>,
) {
    // `#text(lang: "en")[…]` parses as a `call` whose head is the `text` call
    // and whose body is the sibling `content`, so the language is read off the
    // node whose children are being walked.
    let declared = call_language(node, text);
    let scope = declared.as_ref().or(lang);
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        let kind = child.kind();
        if kind == "content" {
            collect_prose(child, text, out, scope);
        } else if !OPAQUE_NODES.contains(&kind) {
            collect_nested_content(child, text, out, scope);
        }
    }
}

/// A language Typst declared, and where it said so.
///
/// The span is what an unchecked-language report is placed on: a `#set
/// text(lang: "he")` is the thing to change, and the prose under it is only
/// where the consequence shows.
struct Declared {
    tag: String,
    span: (usize, usize),
}

/// The BCP-47 tag a `text(…)` call names, if it names one.
///
/// Typst spells the natural language `lang: "de"` with an optional
/// `region: "CH"`, which is the same information as `de-CH` — so a document
/// that already declares its language for hyphenation and quotation marks
/// declares it for the checker too, with no second annotation to keep in sync.
/// Only `text` is read: `lang` means something else on `#set page` and friends.
fn call_language(node: Node, text: &str) -> Option<Declared> {
    let call = child_of_kind(node, "call")?;
    let tag = text_call_language(call, text)?;
    Some(Declared {
        tag,
        span: (call.start_byte(), call.end_byte()),
    })
}

/// The tag named by `#set text(…)`, if `node` is that set rule.
///
/// `#set text(lang: "fr")` parses as `code -> set -> call`, so the rule is one
/// level below the `code` node the walk hands over.
fn set_rule_language(node: Node, text: &str) -> Option<Declared> {
    let set = child_of_kind(node, "set")?;
    let call = child_of_kind(set, "call")?;
    let tag = text_call_language(call, text)?;
    // The whole `#set text(lang: "de")`, not just the tag: that is the line a
    // reader changes when nothing can read the language it names.
    Some(Declared {
        tag,
        span: (node.start_byte(), node.end_byte()),
    })
}

/// Read `lang:` and `region:` off a `text(…)` call node.
fn text_call_language(call: Node, text: &str) -> Option<String> {
    if &text[child_of_kind(call, "ident")?.byte_range()] != "text" {
        return None;
    }
    let group = child_of_kind(call, "group")?;
    let lang = tagged_string(group, text, "lang")?;
    Some(
        tagged_string(group, text, "region")
            .map_or_else(|| lang.to_string(), |region| format!("{lang}-{region}")),
    )
}

/// The string value of `name:` inside an argument `group`.
fn tagged_string<'a>(group: Node, text: &'a str, name: &str) -> Option<&'a str> {
    let mut cursor = group.walk();
    for tagged in group.children(&mut cursor) {
        if tagged.kind() != "tagged" {
            continue;
        }
        let mut inner = tagged.walk();
        let mut key = None;
        let mut value = None;
        for part in tagged.children(&mut inner) {
            match part.kind() {
                "ident" if key.is_none() => key = Some(part),
                "string" if value.is_none() => value = Some(part),
                _ => {}
            }
        }
        if key.is_some_and(|k| &text[k.byte_range()] == name)
            && let Some(value) = value
        {
            // The node spans the quotes; the value is what sits between them.
            return text[value.byte_range()]
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'));
        }
    }
    None
}

/// Characters that delimit inline markup and are not part of the prose.
///
/// Left in the checked text, `_réception_` reaches `LanguageTool` as one token
/// and comes back as a French misspelling. Excluded, the emphasis is invisible
/// to the engine and the sentence still reads as one sentence.
///
/// Quotes and apostrophes are deliberately absent. Typst parses `n'est` as two
/// text nodes around a smart quote, so the apostrophe arrives here as a gap —
/// and excluding it would hand the engine `n est`, breaking every French
/// contraction in the document.
const MARKUP_DELIMITERS: &[char] = &['*', '_', '`'];

/// Record the markup delimiters inside a bridged gap as exclusions.
///
/// Per run rather than the whole gap, so the whitespace and quotes between the
/// delimiters survive as the word boundaries they are.
fn exclude_markup(text: &str, from: usize, to: usize, out: &mut Vec<(usize, usize)>) {
    let mut run: Option<usize> = None;
    for (offset, ch) in text[from..to].char_indices() {
        let at = from + offset;
        if MARKUP_DELIMITERS.contains(&ch) {
            run.get_or_insert(at);
        } else if let Some(start) = run.take() {
            out.push((start, at));
        }
    }
    if let Some(start) = run {
        out.push((start, to));
    }
}

/// Check if a gap between text nodes can be bridged.
///
/// Gaps containing only whitespace (no double newlines) and inline
/// markup delimiters (`*`, `_`, `` ` ``) are bridgeable.
fn is_bridgeable(gap: &str) -> bool {
    // Paragraph breaks are never bridgeable
    if gap.contains("\n\n") || gap.contains("\r\n\r\n") {
        return false;
    }

    gap.chars()
        .all(|c| c.is_whitespace() || "*/_ \"'`".contains(c))
}

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use crate::prose::latex::LatexExtras;
    use anyhow::Result;

    fn typst_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = crate::grammars::TYPST.into();
        ProseExtractor::new(language)
    }

    fn extract_all_prose(text: &str) -> Result<String> {
        let mut extractor = typst_extractor()?;
        let ranges = extractor.extract(text, "typst", &LatexExtras::default())?;
        Ok(ranges.iter().map(|r| r.extract_text(text)).collect())
    }

    #[test]
    fn basic_paragraph() -> Result<()> {
        let prose = extract_all_prose("This is a simple paragraph.\n")?;
        assert!(
            prose.contains("This is a simple paragraph"),
            "got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn heading_extracted() -> Result<()> {
        let prose = extract_all_prose("= Introduction\n\nSome text.\n")?;
        assert!(prose.contains("Introduction"), "got: {prose:?}");
        assert!(prose.contains("Some text"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn emphasis_bridged() -> Result<()> {
        let prose = extract_all_prose("This is _emphasized_ text.\n")?;
        assert!(
            prose.contains("This is") && prose.contains("text"),
            "Emphasis should bridge, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn strong_bridged() -> Result<()> {
        let prose = extract_all_prose("This is *strong* text.\n")?;
        assert!(
            prose.contains("This is") && prose.contains("text"),
            "Strong should bridge, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn code_block_excluded() -> Result<()> {
        let text = "Before code.\n\n```rust\nfn main() {}\n```\n\nAfter code.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Before code"), "got: {prose:?}");
        assert!(prose.contains("After code"), "got: {prose:?}");
        assert!(!prose.contains("fn main"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn inline_code_excluded() -> Result<()> {
        let prose = extract_all_prose("Use the `println` macro.\n")?;
        assert!(prose.contains("Use the"), "got: {prose:?}");
        assert!(prose.contains("macro"), "got: {prose:?}");
        assert!(!prose.contains("println"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn math_excluded() -> Result<()> {
        let prose = extract_all_prose("The formula $E = m c^2$ is famous.\n")?;
        assert!(prose.contains("The formula"), "got: {prose:?}");
        assert!(prose.contains("is famous"), "got: {prose:?}");
        assert!(!prose.contains("E = m"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn display_math_excluded() -> Result<()> {
        let text = "Before math.\n\n$ E = m c^2 $\n\nAfter math.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Before math"), "got: {prose:?}");
        assert!(prose.contains("After math"), "got: {prose:?}");
        assert!(!prose.contains("E = m"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn set_rule_excluded() -> Result<()> {
        let text = "#set text(size: 12pt)\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("12pt"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn show_rule_excluded() -> Result<()> {
        let text = "#show heading: set text(blue)\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("blue"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn import_excluded() -> Result<()> {
        let text = "#import \"template.typ\": *\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("template"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn comment_excluded() -> Result<()> {
        let text = "Some text. // this is a comment\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some text"), "got: {prose:?}");
        assert!(!prose.contains("this is a comment"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn label_and_ref_excluded() -> Result<()> {
        let text = "= Introduction <intro>\n\nSee @intro for details.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Introduction"), "got: {prose:?}");
        assert!(prose.contains("See"), "got: {prose:?}");
        assert!(prose.contains("for details"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn list_items_extracted() -> Result<()> {
        let text = "- First item\n- Second item\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("First item"), "got: {prose:?}");
        assert!(prose.contains("Second item"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn numbered_list_extracted() -> Result<()> {
        let text = "+ One\n+ Two\n+ Three\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("One"), "got: {prose:?}");
        assert!(prose.contains("Two"), "got: {prose:?}");
        assert!(prose.contains("Three"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn paragraph_break_splits_ranges() -> Result<()> {
        let mut extractor = typst_extractor()?;
        let text = "First paragraph.\n\nSecond paragraph.\n";
        let ranges = extractor.extract(text, "typst", &LatexExtras::default())?;
        assert!(
            ranges.len() >= 2,
            "Paragraph break should create separate ranges, got {} ranges",
            ranges.len()
        );
        Ok(())
    }

    #[test]
    fn function_call_content_extracted() -> Result<()> {
        let text = "Some text #box[inner prose] more text.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some text"), "got: {prose:?}");
        assert!(prose.contains("inner prose"), "got: {prose:?}");
        assert!(prose.contains("more text"), "got: {prose:?}");
        assert!(!prose.contains("box"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn block_call_content_extracted() -> Result<()> {
        let text = "#columns(2)[\n  This is some text, and it is checked.\n]\n";
        let prose = extract_all_prose(text)?;
        assert!(
            prose.contains("This is some text, and it is checked."),
            "got: {prose:?}"
        );
        assert!(!prose.contains("columns"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn nested_call_content_extracted() -> Result<()> {
        let text = "#align(center)[#emph[Deeply nested prose.]]\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Deeply nested prose."), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn named_argument_content_extracted() -> Result<()> {
        let text = "#figure(caption: [A caption sentence.])[Body sentence.]\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("A caption sentence."), "got: {prose:?}");
        assert!(prose.contains("Body sentence."), "got: {prose:?}");
        assert!(!prose.contains("caption:"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn call_arguments_still_excluded() -> Result<()> {
        let text = "#text(size: 9pt, fill: blue)[Styled prose.]\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Styled prose."), "got: {prose:?}");
        assert!(!prose.contains("9pt"), "got: {prose:?}");
        assert!(!prose.contains("blue"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn raw_inside_content_excluded() -> Result<()> {
        let text = "#box[Prose with `code_token` inside.]\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Prose with"), "got: {prose:?}");
        assert!(prose.contains("inside"), "got: {prose:?}");
        assert!(!prose.contains("code_token"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn content_in_show_rule_extracted() -> Result<()> {
        let text = "#show: template.with(title: [A rendered title.])\n\nBody prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("A rendered title."), "got: {prose:?}");
        assert!(prose.contains("Body prose."), "got: {prose:?}");
        assert!(!prose.contains("template"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn multiple_headings() -> Result<()> {
        let text = "= Chapter One\n\nText one.\n\n== Section A\n\nText two.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Chapter One"), "got: {prose:?}");
        assert!(prose.contains("Text one"), "got: {prose:?}");
        assert!(prose.contains("Section A"), "got: {prose:?}");
        assert!(prose.contains("Text two"), "got: {prose:?}");
        Ok(())
    }

    // --- Edge case tests ---

    #[test]
    fn nested_emphasis_in_strong() -> Result<()> {
        let prose = extract_all_prose("This is *strongly _emphasized_ text* here.\n")?;
        assert!(prose.contains("This is"), "got: {prose:?}");
        assert!(prose.contains("here"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn unicode_text() -> Result<()> {
        let prose = extract_all_prose("Dies ist ein Beispiel mit Umlauten: ä, ö, ü.\n")?;
        assert!(prose.contains("Umlauten"), "got: {prose:?}");
        assert!(prose.contains("ä"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn cjk_text() -> Result<()> {
        let prose = extract_all_prose("这是一个中文段落。\n")?;
        assert!(prose.contains("中文"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn mixed_prose_and_code_same_line() -> Result<()> {
        let prose = extract_all_prose("Before `code` middle `more` after.\n")?;
        assert!(prose.contains("Before"), "got: {prose:?}");
        assert!(prose.contains("after"), "got: {prose:?}");
        assert!(
            !prose.contains("code"),
            "code should be excluded, got: {prose:?}"
        );
        assert!(
            !prose.contains("more"),
            "code should be excluded, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn multiline_line_comments_excluded() -> Result<()> {
        let text = "Before.\n// first comment\n// second comment\nAfter.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Before"), "got: {prose:?}");
        assert!(prose.contains("After"), "got: {prose:?}");
        assert!(!prose.contains("first comment"), "got: {prose:?}");
        assert!(!prose.contains("second comment"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn let_binding_excluded() -> Result<()> {
        let text = "#let x = 42\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("42"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn include_excluded() -> Result<()> {
        let text = "#include \"chapter.typ\"\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("chapter"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn term_list_extracted() -> Result<()> {
        let text = "/ Term: Definition here\n/ Another: Second definition\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Definition here"), "got: {prose:?}");
        assert!(prose.contains("Second definition"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn url_excluded() -> Result<()> {
        let prose = extract_all_prose("Visit https://example.com for details.\n")?;
        assert!(prose.contains("Visit"), "got: {prose:?}");
        assert!(prose.contains("for details"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn empty_document() -> Result<()> {
        let mut extractor = typst_extractor()?;
        let ranges = extractor.extract("", "typst", &LatexExtras::default())?;
        assert!(ranges.is_empty(), "Empty doc should produce no ranges");
        Ok(())
    }

    #[test]
    fn only_code_no_prose() -> Result<()> {
        let text = "#set text(size: 12pt)\n#show heading: set text(blue)\n#let x = 1\n";
        let prose = extract_all_prose(text)?;
        assert!(
            prose.trim().is_empty(),
            "Only code should produce no prose, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn heading_with_emphasis() -> Result<()> {
        let prose = extract_all_prose("= A _very_ important heading\n\nBody.\n")?;
        assert!(prose.contains("important heading"), "got: {prose:?}");
        assert!(prose.contains("Body"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn multiple_math_inline() -> Result<()> {
        let prose = extract_all_prose("We have $a$ and $b$ as variables.\n")?;
        assert!(prose.contains("We have"), "got: {prose:?}");
        assert!(prose.contains("as variables"), "got: {prose:?}");
        Ok(())
    }

    /// `(prose, the language it was tagged with)` for every extracted range.
    fn extract_with_languages(text: &str) -> Result<Vec<(String, Option<String>)>> {
        let mut extractor = typst_extractor()?;
        Ok(extractor
            .extract(text, "typst", &LatexExtras::default())?
            .iter()
            .map(|r| (r.extract_text(text).into_owned(), r.language.clone()))
            .collect())
    }

    #[test]
    fn prose_without_a_declaration_carries_no_language() -> Result<()> {
        let ranges = extract_with_languages("Just a paragraph.\n")?;
        assert_eq!(ranges[0].1, None);
        Ok(())
    }

    #[test]
    fn a_text_call_scopes_its_language_to_its_content() -> Result<()> {
        let ranges = extract_with_languages(
            "Du texte en francais.\n\n#text(lang: \"en\")[An English aside.]\n\nEncore du francais.\n",
        )?;
        let tagged: Vec<_> = ranges.iter().map(|(_, lang)| lang.as_deref()).collect();
        assert_eq!(tagged, vec![None, Some("en"), None]);
        Ok(())
    }

    #[test]
    fn a_set_rule_applies_to_the_rest_of_its_block() -> Result<()> {
        let ranges = extract_with_languages(
            "#set text(lang: \"fr\")\n\nDu texte en francais.\n\n             #[\n  #set text(lang: \"en\")\n  An English aside.\n]\n\nEncore du francais.\n",
        )?;
        let tagged: Vec<_> = ranges.iter().map(|(_, lang)| lang.as_deref()).collect();
        // The set rule inside the block does not leak back out of it.
        assert_eq!(tagged, vec![Some("fr"), Some("en"), Some("fr")]);
        Ok(())
    }

    #[test]
    fn a_region_argument_becomes_the_bcp_47_subtag() -> Result<()> {
        let ranges =
            extract_with_languages("#set text(lang: \"de\", region: \"CH\")\n\nEin Satz.\n")?;
        assert_eq!(ranges[0].1.as_deref(), Some("de-CH"));
        Ok(())
    }

    #[test]
    fn lang_on_another_function_is_not_a_language_declaration() -> Result<()> {
        // `lang` means something else outside `text`, so only `text` is read.
        let ranges = extract_with_languages("#figure(lang: \"en\")[A caption.]\n")?;
        assert_eq!(ranges[0].1, None);
        Ok(())
    }

    #[test]
    fn two_languages_on_one_line_are_not_bridged_into_one_range() -> Result<()> {
        let ranges = extract_with_languages("Du francais #text(lang: \"en\")[and English] ici.\n")?;
        let tagged: Vec<_> = ranges.iter().map(|(_, lang)| lang.as_deref()).collect();
        assert_eq!(tagged, vec![None, Some("en"), None]);
        Ok(())
    }
}
