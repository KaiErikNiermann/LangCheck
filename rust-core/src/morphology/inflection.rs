//! Regular inflections, generated rather than stripped.
//!
//! Stripping `-ed` off `occured` finds `occur` and accepts a misspelling; generating
//! from `occur` produces `occurred` and never proposes `occured` at all. The difference
//! is the orthographic conditions — `y`→`ies`, e-deletion, consonant doubling — which
//! only exist in the forward direction. So the inflected forms of every dictionary word
//! are materialised once and looked up like any other entry.
//!
//! The expander is harper's, driven by the attribute list in
//! `dictionaries/affixes/attributes.json`. What is *not* borrowed from harper is the
//! decision about which words get which flags: harper's own flags are editorial rather
//! than grammatical — 68% of its `-ation` lemmas carry no plural flag, and 29,584 of its
//! 53,304 lemmas carry no inflection flag at all — because they record which forms
//! harper chose to list, not which forms English allows. Inferring a paradigm from them
//! teaches that `-ation` has no plural, so the profile below is stated outright instead.

use std::collections::HashSet;

use anyhow::{Context, Result};
use harper_core::spell::{Dictionary as HarperDictionary, MutableDictionary};

/// The affix classes, in harper's rune format.
static ATTRIBUTES: &str = include_str!("../../dictionaries/affixes/attributes.json");

/// Shortest lemma worth inflecting. Below this a "word" is an initialism or a symbol.
const MIN_LEMMA_CHARS: usize = 4;

/// Endings that mean the word is already an inflected form.
///
/// Wordlists are full of them — `mathematics.txt` carries `algebras` next to `algebra` —
/// and inflecting an inflection produces only noise (`algebrases`).
const ALREADY_INFLECTED: [&str; 4] = ["s", "ed", "ing", "ly"];

/// Endings that mark a verb whose regular past and progressive are worth generating.
///
/// Deliberately narrow. English converts nouns to verbs freely, but generating
/// `quotienting` from the noun `quotient` is the same move that generates `childs` from
/// `child`: it invents a paradigm the word may not have. These four endings are verbal
/// by morphology, not by guess.
const VERBAL_ENDINGS: [&str; 4] = ["ate", "ize", "ise", "ify"];

/// Which affix classes a lemma may take, as rune flags.
///
/// `None` means "generate nothing" — the word is already inflected, too short, or not
/// plain letters.
#[must_use]
pub fn flags_for(word: &str) -> Option<&'static str> {
    if word.chars().count() < MIN_LEMMA_CHARS || !word.chars().all(|c| c.is_ascii_lowercase()) {
        return None;
    }
    if ALREADY_INFLECTED
        .iter()
        .any(|ending| word.ends_with(ending))
    {
        return None;
    }
    if VERBAL_ENDINGS.iter().any(|ending| word.ends_with(ending)) && !doubles_final_consonant(word)
    {
        return Some("SdG");
    }
    Some("S")
}

/// Whether the regular past and progressive of `word` would double its final consonant.
///
/// `occur`→`occurred`, `stop`→`stopped`. The attribute list cannot express doubling, so
/// a stem that needs it would be expanded to `occured` — precisely the misspelling this
/// module exists to avoid generating. Such stems are given no past or progressive at
/// all; the correct forms are usually already in the wordlist.
fn doubles_final_consonant(word: &str) -> bool {
    let tail: Vec<char> = word.chars().rev().take(3).collect();
    let [last, middle, first] = tail[..] else {
        return false;
    };
    is_consonant(first)
        && is_vowel(middle)
        && is_consonant(last)
        && !matches!(last, 'w' | 'x' | 'y')
}

const fn is_vowel(c: char) -> bool {
    matches!(c, 'a' | 'e' | 'i' | 'o' | 'u')
}

const fn is_consonant(c: char) -> bool {
    c.is_ascii_lowercase() && !is_vowel(c)
}

/// Every regular inflection of `lemmas` that is not already among them.
///
/// Returns the delta rather than the whole expansion so callers can keep generated forms
/// in their own set — the user's dictionary file must go on recording what the user
/// typed, not what was derived from it.
pub fn expand<'a>(lemmas: impl IntoIterator<Item = &'a str>) -> Result<HashSet<String>> {
    // Everything handed in counts as already-present, not just the words that were
    // inflectable: a list carrying both `algebra` and `algebras` must yield neither.
    let originals: HashSet<&str> = lemmas.into_iter().collect();
    let annotated: Vec<String> = originals
        .iter()
        .filter_map(|word| flags_for(word).map(|flags| format!("{word}/{flags}")))
        .collect();
    if annotated.is_empty() {
        return Ok(HashSet::new());
    }

    // The first line is an item count, which the rune parser requires.
    let word_list = format!("{}\n{}", annotated.len(), annotated.join("\n"));
    let expanded = MutableDictionary::from_rune_files(&word_list, ATTRIBUTES)
        // `rune::Error` is not nameable outside harper, so it cannot be propagated.
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("expanding dictionary inflections")?;

    Ok(expanded
        .words_iter()
        .map(|chars| chars.iter().collect::<String>())
        .filter(|word| !originals.contains(word.as_str()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{expand, flags_for};

    fn forms(word: &str) -> Vec<String> {
        let mut forms: Vec<String> = expand([word]).unwrap().into_iter().collect();
        forms.sort();
        forms
    }

    #[test]
    fn a_noun_gets_its_plural() {
        assert_eq!(forms("algebra"), ["algebras"]);
        assert_eq!(forms("matrix"), ["matrixes"]);
        assert_eq!(forms("category"), ["categories"]);
    }

    #[test]
    fn a_verbal_ending_also_gets_past_and_progressive() {
        assert_eq!(forms("quantize"), ["quantized", "quantizes", "quantizing"]);
    }

    #[test]
    fn a_doubling_stem_is_given_no_past_or_progressive() {
        // `occur` + `ed` would be spelled `occured` by these rules, which is a typo.
        assert_eq!(flags_for("occur"), Some("S"));
        assert!(!forms("occur").contains(&"occured".to_string()));
    }

    #[test]
    fn already_inflected_entries_are_left_alone() {
        // Wordlists carry both; inflecting the inflection yields only noise.
        assert_eq!(flags_for("algebras"), None);
        assert_eq!(flags_for("quotienting"), None);
        assert_eq!(flags_for("formally"), None);
        assert!(forms("algebras").is_empty());
    }

    #[test]
    fn nouns_are_not_conjugated() {
        // `quotienting` is the same invention as `childs`; the corpus wants it, the
        // safety argument does not allow it.
        assert_eq!(flags_for("quotient"), Some("S"));
    }

    #[test]
    fn short_entries_and_symbols_are_skipped() {
        assert_eq!(flags_for("fst"), None);
        assert_eq!(flags_for("C++"), None);
        assert_eq!(flags_for("Vec"), None);
    }

    #[test]
    fn expansion_excludes_the_input() {
        let out = expand(["algebra", "algebras"]).unwrap();
        assert!(!out.contains("algebra"));
        assert!(!out.contains("algebras"));
    }
}
