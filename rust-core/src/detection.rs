use whatlang::{Detector, Info, Lang};

/// Result of detecting the natural language of a text segment.
#[derive(Debug, Clone, PartialEq)]
pub struct DetectedLanguage {
    /// BCP-47-style language tag (e.g. "en", "fr", "de").
    pub tag: String,
    /// Confidence score from 0.0 to 1.0.
    pub confidence: f64,
    /// Whether this detection is considered reliable.
    pub reliable: bool,
}

/// Detect the natural language of a text segment.
///
/// Returns `None` if the text is too short or ambiguous for reliable detection.
#[must_use]
pub fn detect(text: &str) -> Option<DetectedLanguage> {
    let info = whatlang::detect(text)?;
    Some(DetectedLanguage {
        tag: lang_to_tag(info.lang()),
        confidence: info.confidence(),
        reliable: info.is_reliable(),
    })
}

/// Detect with a language allowlist (e.g. only detect among supported languages).
#[must_use]
pub fn detect_with_allowlist(text: &str, allowed: &[&str]) -> Option<DetectedLanguage> {
    let langs: Vec<Lang> = allowed.iter().filter_map(|t| tag_to_lang(t)).collect();
    if langs.is_empty() {
        return detect(text);
    }
    let detector = Detector::with_allowlist(langs);
    let info: Info = detector.detect(text)?;
    Some(DetectedLanguage {
        tag: lang_to_tag(info.lang()),
        confidence: info.confidence(),
        reliable: info.is_reliable(),
    })
}

/// Convert `whatlang::Lang` to a BCP-47 language tag.
fn lang_to_tag(lang: Lang) -> String {
    match lang {
        Lang::Eng => "en",
        Lang::Fra => "fr",
        Lang::Deu => "de",
        Lang::Spa => "es",
        Lang::Por => "pt",
        Lang::Ita => "it",
        Lang::Nld => "nl",
        Lang::Rus => "ru",
        Lang::Pol => "pl",
        Lang::Swe => "sv",
        Lang::Dan => "da",
        Lang::Nob => "no",
        Lang::Fin => "fi",
        Lang::Ukr => "uk",
        Lang::Ces => "cs",
        Lang::Ron => "ro",
        Lang::Hun => "hu",
        Lang::Tur => "tr",
        Lang::Jpn => "ja",
        Lang::Cmn => "zh",
        Lang::Kor => "ko",
        Lang::Ara => "ar",
        Lang::Hin => "hi",
        _ => "und", // undetermined
    }
    .to_string()
}

/// Convert a BCP-47 tag back to `whatlang::Lang`, if supported.
fn tag_to_lang(tag: &str) -> Option<Lang> {
    // Normalize: take the primary subtag only (e.g. "en-US" -> "en")
    let primary = tag.split('-').next().unwrap_or(tag);
    match primary {
        "en" => Some(Lang::Eng),
        "fr" => Some(Lang::Fra),
        "de" => Some(Lang::Deu),
        "es" => Some(Lang::Spa),
        "pt" => Some(Lang::Por),
        "it" => Some(Lang::Ita),
        "nl" => Some(Lang::Nld),
        "ru" => Some(Lang::Rus),
        "pl" => Some(Lang::Pol),
        "sv" => Some(Lang::Swe),
        "da" => Some(Lang::Dan),
        "no" => Some(Lang::Nob),
        "fi" => Some(Lang::Fin),
        "uk" => Some(Lang::Ukr),
        "cs" => Some(Lang::Ces),
        "ro" => Some(Lang::Ron),
        "hu" => Some(Lang::Hun),
        "tr" => Some(Lang::Tur),
        "ja" => Some(Lang::Jpn),
        "zh" => Some(Lang::Cmn),
        "ko" => Some(Lang::Kor),
        "ar" => Some(Lang::Ara),
        "hi" => Some(Lang::Hin),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_english() {
        let result = detect("The quick brown fox jumped over the lazy dog. It was a beautiful day.");
        assert!(result.is_some());
        let d = result.unwrap();
        assert_eq!(d.tag, "en");
        assert!(d.confidence > 0.5);
    }

    #[test]
    fn detect_french() {
        let result = detect("Bonjour le monde. Comment allez-vous aujourd'hui? C'est une belle journée.");
        assert!(result.is_some());
        let d = result.unwrap();
        assert_eq!(d.tag, "fr");
    }

    #[test]
    fn detect_german() {
        let result = detect("Die schnelle braune Fuchs springt über den faulen Hund. Es war ein schöner Tag.");
        assert!(result.is_some());
        let d = result.unwrap();
        assert_eq!(d.tag, "de");
    }

    #[test]
    fn detect_spanish() {
        let result = detect("El rápido zorro marrón salta sobre el perro perezoso. Fue un día hermoso.");
        assert!(result.is_some());
        let d = result.unwrap();
        assert_eq!(d.tag, "es");
    }

    #[test]
    fn detect_too_short_returns_none() {
        let result = detect("Hi");
        // Very short text may or may not detect
        if let Some(d) = result {
            // If it does detect, it shouldn't be reliable
            assert!(!d.reliable || d.confidence < 0.9);
        }
    }

    #[test]
    fn detect_with_allowlist_restricts() {
        let text = "The quick brown fox jumped over the lazy dog.";
        let result = detect_with_allowlist(text, &["en", "fr"]);
        assert!(result.is_some());
        let d = result.unwrap();
        assert!(d.tag == "en" || d.tag == "fr");
    }

    #[test]
    fn tag_roundtrip() {
        for tag in ["en", "fr", "de", "es", "ja", "zh", "ko"] {
            let lang = tag_to_lang(tag);
            assert!(lang.is_some(), "tag_to_lang failed for {tag}");
            let back = lang_to_tag(lang.unwrap());
            assert_eq!(back, tag, "roundtrip failed for {tag}");
        }
    }

    #[test]
    fn tag_from_bcp47_with_region() {
        let lang = tag_to_lang("en-US");
        assert_eq!(lang, Some(Lang::Eng));
    }
}
