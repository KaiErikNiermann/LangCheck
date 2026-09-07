//! Fixtures shared by the suppression precision harnesses.
//!
//! The typo corpus is the hard gate for every feature that can silence a spelling
//! diagnostic — name detection and morphological acceptance both — so it lives in one
//! place. A misspelling that stops being reported destroys trust in every remaining
//! squiggle, and that failure must not be discoverable in one harness and invisible in
//! the other.

/// Real misspellings with the corrections an engine actually proposes, written the way a
/// person types them: lowercase, mid-sentence, in ordinary prose.
///
/// The last block is specific to affix analysis: each of those decomposes into known
/// material and is nevertheless a typo, which is why decomposition alone may never
/// suppress anything.
pub const TYPO_CORPUS: &[(&str, &[&str])] = &[
    ("recieve", &["receive", "relieve"]),
    ("seperate", &["separate"]),
    ("definately", &["definitely"]),
    ("occured", &["occurred"]),
    ("adress", &["address", "dress"]),
    ("begining", &["beginning"]),
    ("enviroment", &["environment"]),
    ("succesful", &["successful"]),
    ("neccessary", &["necessary"]),
    ("similiar", &["similar"]),
    ("tommorow", &["tomorrow"]),
    ("untill", &["until"]),
    ("goverment", &["government"]),
    ("completly", &["completely"]),
    ("independant", &["independent"]),
    ("reccomend", &["recommend"]),
    ("thier", &["their", "there"]),
    ("alot", &["a lot", "allot"]),
    ("wich", &["which", "witch"]),
    ("teh", &["the"]),
    ("acheive", &["achieve"]),
    ("beleive", &["believe"]),
    ("calender", &["calendar"]),
    ("cemetary", &["cemetery"]),
    ("collegue", &["colleague"]),
    ("concious", &["conscious"]),
    ("existance", &["existence"]),
    ("foriegn", &["foreign"]),
    ("gaurd", &["guard"]),
    ("harrass", &["harass"]),
    // Misspellings that a naive affix analysis reads as well-formed derivations.
    //
    // `subsequential` deliberately does *not* appear: it decomposes as `sub` +
    // `sequential` and is a real word — "subsequential limit" is standard in analysis.
    // A word being rare is not the same as it being wrong.
    ("recomend", &["recommend"]),
    ("intergrate", &["integrate"]),
    ("immediatly", &["immediately"]),
    ("preceed", &["precede"]),
    ("supercede", &["supersede"]),
    ("dependancy", &["dependency"]),
    ("occurance", &["occurrence"]),
    ("miniscule", &["minuscule"]),
    ("noticable", &["noticeable"]),
];
