//! The packs `lang-check` knows how to fetch, pinned to the bytes it expects.
//!
//! Every entry carries a SHA-256 and a byte count recorded when the entry was
//! written. A download that does not match both is refused and nothing is
//! installed. That is the point: a mirror, a CDN or the host itself can be
//! compromised, and a checker that fetches a word list and feeds it to a
//! parser is a fine place to put a payload. Pinning means an attacker has to
//! break the hash rather than the web server.
//!
//! The cost is that a pin goes stale when upstream republishes. That is
//! deliberate -- an upstream change and an attack look identical over the
//! wire, so the honest response is to stop and say the published dictionary no
//! longer matches, rather than to trust whatever arrived.

/// One downloadable file, and the bytes it must turn out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteFile {
    pub url: &'static str,
    /// Lowercase hex SHA-256 of the file's exact bytes.
    pub sha256: &'static str,
    pub bytes: u64,
}

/// A pack that can be installed without the user finding it themselves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CataloguePack {
    /// The BCP-47 tag a document declares.
    pub language: &'static str,
    /// The stem the files are written under, which is what resolution expects.
    pub stem: &'static str,
    pub aff: RemoteFile,
    pub dic: RemoteFile,
    /// The dictionary's own licence, which is not this project's.
    ///
    /// Shown before anything is downloaded, because these are strong copyleft
    /// terms and a user installing one should know that rather than discover
    /// it later.
    pub licence: &'static str,
    /// Where the words came from, for the same reason.
    pub provenance: &'static str,
}

/// Hosts a pack may be fetched from.
///
/// An allowlist rather than a scheme check alone: a pinned digest already
/// stops altered content, and this stops a future catalogue entry from
/// quietly pointing somewhere nobody reviewed.
pub const ALLOWED_HOSTS: &[&str] = &["raw.githubusercontent.com"];

/// The packs with a known-good source.
///
/// Short on purpose. An entry means the bytes have been fetched, checked and
/// pinned by hand; a language absent from here is still usable by pointing
/// `engines.hunspell.dictionary_paths` at a pack installed any other way.
pub const CATALOGUE: &[CataloguePack] = &[CataloguePack {
    language: "he",
    stem: "he_IL",
    aff: RemoteFile {
        url: "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/he_IL/he_IL.aff",
        sha256: "6caf86b3a545be5614f135d33a48baa244a59aca43f051dda6173d5d9cbc7700",
        bytes: 78_883,
    },
    dic: RemoteFile {
        url: "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/he_IL/he_IL.dic",
        sha256: "5f5331f90ed775bd527f6fb7ad1ead9a1b7d8ce46ad640c2387d9d1dc91d3058",
        bytes: 7_796_259,
    },
    licence: "AGPL-3.0-only",
    provenance: "Hspell 1.4, via the LibreOffice dictionaries repository",
}];

/// The catalogue entry for a language, if there is one.
///
/// Matched on the primary subtag, so `he-IL` finds the `he` entry.
#[must_use]
pub fn find(language: &str) -> Option<&'static CataloguePack> {
    let primary = language
        .split(['-', '_'])
        .next()
        .unwrap_or(language)
        .to_ascii_lowercase();
    if primary.is_empty() {
        return None;
    }
    CATALOGUE
        .iter()
        .find(|pack| pack.language.eq_ignore_ascii_case(&primary))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_is_fetched_over_https_from_an_allowed_host() {
        for pack in CATALOGUE {
            for file in [&pack.aff, &pack.dic] {
                assert!(
                    file.url.starts_with("https://"),
                    "{} is not https: {}",
                    pack.language,
                    file.url
                );
                let host = file
                    .url
                    .trim_start_matches("https://")
                    .split('/')
                    .next()
                    .unwrap_or_default();
                assert!(
                    ALLOWED_HOSTS.contains(&host),
                    "{} points at {host}, which is not on the allowlist",
                    pack.language
                );
            }
        }
    }

    #[test]
    fn every_entry_pins_a_full_length_digest_and_a_size() {
        for pack in CATALOGUE {
            for file in [&pack.aff, &pack.dic] {
                assert_eq!(
                    file.sha256.len(),
                    64,
                    "{}: a SHA-256 is 64 hex characters",
                    pack.language
                );
                assert!(
                    file.sha256
                        .chars()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
                    "{}: digest must be lowercase hex",
                    pack.language
                );
                assert!(
                    file.bytes > 0,
                    "{}: a size of zero pins nothing",
                    pack.language
                );
            }
        }
    }

    #[test]
    fn every_entry_states_its_licence_and_where_the_words_came_from() {
        // These are strong copyleft terms on someone else's work; installing
        // one without saying so is not a thing to do quietly.
        for pack in CATALOGUE {
            assert!(!pack.licence.is_empty(), "{}", pack.language);
            assert!(!pack.provenance.is_empty(), "{}", pack.language);
        }
    }

    #[test]
    fn a_language_is_found_by_its_primary_subtag() {
        assert_eq!(find("he").map(|p| p.stem), Some("he_IL"));
        assert_eq!(find("he-IL").map(|p| p.stem), Some("he_IL"));
        assert_eq!(find("HE").map(|p| p.stem), Some("he_IL"));
        assert!(find("la").is_none(), "Latin ships only as an archive");
        assert!(find("").is_none());
    }
}
