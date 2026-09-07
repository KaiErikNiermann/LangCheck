//! Morphological acceptance: recognising a word built on material already known.
//!
//! Adding `algebra` to a dictionary implies `subalgebra`, `quasi-algebra` and
//! `algebraicity` too. Materialising that closure is impossible — prefixes are freely
//! composable, so the set is unbounded — so it is *recognised* at check time instead:
//! peel affixes off the flagged token and ask whether what is left is known.
//!
//! # Why derivation is analysed but inflection is generated
//!
//! Stripping is the wrong tool for inflection. `occur` + `-ed` is `occurred`, not
//! `occured`, and a stripper cannot see that: it removes `ed`, finds `occur`, and
//! accepts a real misspelling. The same shape accepts `childs` and `mouses`, which are
//! errors a checker exists to catch. Inflection is therefore *generated* — see
//! [`crate::dictionary`] — where the orthographic conditions still apply.
//!
//! Derivation is the opposite case. `-ness`, `-ity`, `-able` and the prefixes attach
//! without conditions, and no table can say which of twenty derivational suffixes a
//! given root licenses, so generation would either miss most real words or invent
//! nonsense. Here the residue constraint does the work: `subadditivity` is accepted
//! only because `sub-` peels, `-ivity` restores `-ive`, and `additive` is a real word.
//!
//! # What stops this from accepting typos
//!
//! The guards here — a minimum root length, one prefix at most, a bounded number of
//! suffix steps — are weak on their own. `untill` decomposes as `un` + `till`, and
//! `till` really is a noun and a verb.
//!
//! The guard that carries the decision lives in [`crate::suppression`]: a token one
//! edit away from a word the engine itself proposed is a typo, not a coinage. Measured
//! over single-edit misspellings of common English words, decomposition alone accepts
//! about 1%; with the suggestion test it accepts none. Nothing here should be read as
//! safe without that check.

use std::sync::{Arc, LazyLock};

use harper_core::spell::{Dictionary as HarperDictionary, FstDictionary};

use crate::dictionary::Dictionary;

/// Hyphen characters treated as compound joiners.
///
/// The ASCII hyphen plus the two Unicode hyphens that survive a copy-paste from typeset
/// text. En and em dashes are punctuation, not joiners, and are excluded.
pub const HYPHENS: [char; 3] = ['-', '\u{2010}', '\u{2011}'];

/// Shortest residue that may be treated as a root.
///
/// Three, not four, because `set`, `map` and `ring` are the stems this vocabulary is
/// built from, and `subset`, `submap` and `coset` are words worth accepting. Measured
/// against a typo corpus, three and four leak identically, so the shorter bound is free.
const MIN_ROOT_CHARS: usize = 3;

/// How many derivational suffixes may be peeled from one token.
///
/// Two reaches `subadditivity` (`sub-` then `-ivity`) and `equisatisfiability`
/// (`-ability` then `-y`); a third step buys no attested word and widens the search.
const MAX_SUFFIX_STEPS: usize = 2;

/// The productive prefix list, embedded at build time.
static PREFIX_LIST: &str = include_str!("../dictionaries/affixes/prefixes.txt");

/// Prefixes ordered longest first, so `counter` is tried before `co`.
static PREFIXES: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    let mut prefixes: Vec<&'static str> = PREFIX_LIST
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    prefixes.sort_unstable_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    prefixes
});

/// Harper's curated dictionary, consulted as a root oracle and for part of speech.
///
/// Already built unconditionally by the harper engine, so this is usually free; when
/// harper is switched off it costs one lazy FST deserialisation.
static CURATED: LazyLock<Arc<FstDictionary>> = LazyLock::new(FstDictionary::curated);

/// A derivational suffix, with the stem endings it may put back.
///
/// `-ivity` restores `-ive` so `additivity` reaches `additive`; `-ity` restores a bare
/// `e` so `activity` reaches `active`. An empty restoration is plain concatenation.
struct SuffixRule {
    suffix: &'static str,
    restores: &'static [&'static str],
}

/// The derivational suffixes, longest first so `-ability` is tried before `-ity`.
///
/// Only *derivational* suffixes belong here — ones that build a new lexeme. Plural,
/// past and progressive are inflectional and are generated instead, because stripping
/// them accepts `childs` and `occured`.
///
/// Two deliberate omissions, both learned from measurement:
/// * `-ly` does **not** restore a bare `e`. It would reach `immediate` from the
///   misspelling `immediatly`, and no real word needs it — `simply` is served by the
///   `le` restoration instead.
/// * there is no `-ing`/`-ed`/`-s` rule, for the reason in the module docs.
const SUFFIX_RULES: &[SuffixRule] = &[
    SuffixRule {
        suffix: "ization",
        restores: &["ize", "izes", ""],
    },
    SuffixRule {
        suffix: "isation",
        restores: &["ise", "ises", ""],
    },
    SuffixRule {
        suffix: "ability",
        restores: &["able", ""],
    },
    SuffixRule {
        suffix: "ibility",
        restores: &["ible"],
    },
    SuffixRule {
        suffix: "izable",
        restores: &["ize", ""],
    },
    SuffixRule {
        suffix: "ivity",
        restores: &["ive"],
    },
    SuffixRule {
        suffix: "ical",
        restores: &["y", "ic", ""],
    },
    SuffixRule {
        suffix: "ally",
        restores: &["", "al", "ic"],
    },
    SuffixRule {
        suffix: "ness",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "less",
        restores: &[""],
    },
    SuffixRule {
        suffix: "ship",
        restores: &[""],
    },
    SuffixRule {
        suffix: "hood",
        restores: &[""],
    },
    SuffixRule {
        suffix: "wise",
        restores: &[""],
    },
    SuffixRule {
        suffix: "able",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ible",
        restores: &[""],
    },
    SuffixRule {
        suffix: "ity",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ism",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ist",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ful",
        restores: &[""],
    },
    SuffixRule {
        suffix: "oid",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ify",
        restores: &["", "y"],
    },
    SuffixRule {
        suffix: "ize",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ise",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ic",
        restores: &["", "y", "e"],
    },
    SuffixRule {
        suffix: "al",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "ly",
        restores: &["", "le"],
    },
    SuffixRule {
        suffix: "or",
        restores: &["", "e"],
    },
    SuffixRule {
        suffix: "er",
        restores: &["", "e"],
    },
];

/// One affix removed on the way to a known root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AffixStep {
    /// A productive prefix, as written in the prefix list.
    Prefix(&'static str),
    /// A derivational suffix, as written in [`SUFFIX_RULES`].
    Suffix(&'static str),
}

/// A successful reading of a token as affixed known material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Analysis {
    /// The known word the token was built on.
    pub root: String,
    /// The affixes removed to reach it, outermost first.
    pub steps: Vec<AffixStep>,
}

impl Analysis {
    /// The decomposition as `sub-+algebra`, for logs and the inspector.
    #[must_use]
    pub fn describe(&self) -> String {
        let mut out = String::new();
        for step in &self.steps {
            match step {
                AffixStep::Prefix(prefix) => {
                    out.push_str(prefix);
                    out.push_str("-+");
                }
                AffixStep::Suffix(suffix) => {
                    out.push_str("+-");
                    out.push_str(suffix);
                    out.push('/');
                }
            }
        }
        out.push_str(&self.root);
        out
    }
}

/// Decides whether a flagged token is a well-formed derivation of known material.
///
/// Holds no dictionary: the servers keep theirs behind an `Arc<Mutex<..>>` and lock it
/// per check, so the lexicon is passed to [`Self::analyze`] instead of borrowed here.
#[derive(Debug, Clone)]
pub struct AffixAnalyzer {
    english: bool,
}

impl AffixAnalyzer {
    /// Build an analyzer for a BCP-47 language tag.
    ///
    /// Only English is analysed. German `un-`/`über-` prefixation composes with
    /// noun-noun compounding, which is a segmentation problem this cannot express, and
    /// guessing there would suppress real misspellings.
    #[must_use]
    pub fn new(language: &str) -> Self {
        Self {
            english: language.to_lowercase().starts_with("en"),
        }
    }

    /// Read `token` as affixed known material, or return `None`.
    ///
    /// At least one affix must be removed: a token that is already a word in its own
    /// right yields `None`, not an empty analysis.
    ///
    /// The caller **must** still check the token against the engine's own suggestions
    /// before acting on a hit; see the module docs.
    #[must_use]
    pub fn analyze(&self, token: &str, dictionary: Option<&Dictionary>) -> Option<Analysis> {
        if !self.english {
            return None;
        }
        let lowered = token.to_lowercase();
        if !lowered
            .chars()
            .all(|c| c.is_ascii_alphabetic() || HYPHENS.contains(&c))
        {
            return None;
        }

        let mut steps = Vec::new();
        strip_prefix(&lowered, dictionary, &mut steps).or_else(|| {
            steps.clear();
            strip_suffixes(&lowered, dictionary, &mut steps)
        })
    }
}

/// Try one productive prefix, then let the suffix rules finish the job.
///
/// At most one prefix: allowing two lets `recomend` read as `re` + `co` + `mend`, and
/// no attested word needs a second.
fn strip_prefix(
    word: &str,
    dictionary: Option<&Dictionary>,
    steps: &mut Vec<AffixStep>,
) -> Option<Analysis> {
    for prefix in PREFIXES.iter() {
        let Some(rest) = word.strip_prefix(prefix) else {
            continue;
        };
        let residue = rest.strip_prefix(HYPHENS).unwrap_or(rest);
        if residue.len() < MIN_ROOT_CHARS || residue.starts_with(HYPHENS) {
            continue;
        }
        steps.push(AffixStep::Prefix(prefix));
        if let Some(analysis) = strip_suffixes(residue, dictionary, steps) {
            return Some(analysis);
        }
        steps.pop();
    }
    None
}

/// Peel derivational suffixes until the residue is a known word.
///
/// Recurses at most [`MAX_SUFFIX_STEPS`] deep and never reuses a rule, so it terminates
/// and cannot cycle between two spellings of the same ending.
fn strip_suffixes(
    word: &str,
    dictionary: Option<&Dictionary>,
    steps: &mut Vec<AffixStep>,
) -> Option<Analysis> {
    // Only a residue counts as a root. At the top of a suffix-only search `steps` is
    // empty and `word` is the token itself, and a token that is already a word is not
    // an affixed form — it is one engine flagging what another engine's dictionary
    // contains, which is a different feature.
    if !steps.is_empty() && is_known(word, dictionary) {
        return Some(Analysis {
            root: word.to_string(),
            steps: steps.clone(),
        });
    }
    if steps
        .iter()
        .filter(|s| matches!(s, AffixStep::Suffix(_)))
        .count()
        >= MAX_SUFFIX_STEPS
    {
        return None;
    }

    for rule in SUFFIX_RULES {
        if steps.contains(&AffixStep::Suffix(rule.suffix)) {
            continue;
        }
        let Some(stem) = word.strip_suffix(rule.suffix) else {
            continue;
        };
        steps.push(AffixStep::Suffix(rule.suffix));
        for restore in rule.restores {
            let candidate = format!("{stem}{restore}");
            if candidate.len() < MIN_ROOT_CHARS {
                continue;
            }
            if let Some(analysis) = strip_suffixes(&candidate, dictionary, steps) {
                return Some(analysis);
            }
        }
        steps.pop();
    }
    None
}

/// Whether `word` is a word either the workspace or harper already knows.
///
/// Harper's curated dictionary is consulted as well as the configured wordlists so that
/// `semicontinuity` resolves through `continuity` without anybody having to add a
/// general-English list to the project.
fn is_known(word: &str, dictionary: Option<&Dictionary>) -> bool {
    dictionary.is_some_and(|d| d.contains(word)) || CURATED.contains_word_str(word)
}

#[cfg(test)]
mod tests;
