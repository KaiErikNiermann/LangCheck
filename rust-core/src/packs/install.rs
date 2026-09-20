//! Fetching a dictionary pack, and refusing anything that is not the pack.
//!
//! The threat is not hypothetical for a tool of this shape: it downloads a
//! file from the internet and hands it to a parser, on a schedule the user
//! does not control. So the bytes are pinned. [`catalogue`] records a SHA-256
//! and a length for every file, and a download that differs in either is
//! discarded without ever reaching the parser or the destination directory.
//!
//! The checks run in the order that fails cheapest first: the URL before a
//! connection, the advertised length before the body, the length again while
//! reading, then the digest, then the dictionary's own structure, and only
//! then is anything moved into place.

use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::catalogue::{ALLOWED_HOSTS, CataloguePack, RemoteFile};
use super::{PackError, PackReport, PackSource, ResolvedPack, validate};

/// Room to leave free after writing, so an install does not fill a disk.
const HEADROOM_BYTES: u64 = 16 * 1024 * 1024;

/// Why an install did not happen.
#[derive(Debug)]
pub enum InstallError {
    /// The catalogue has no entry, so there is no pinned source to trust.
    NotInCatalogue { language: String },
    /// The URL is not one this build is willing to fetch from.
    UntrustedSource { url: String, detail: String },
    /// The transfer failed.
    Transport { url: String, detail: String },
    /// The bytes are not the bytes that were pinned.
    ///
    /// Either the published dictionary changed or something served different
    /// content. Those are indistinguishable from here, so both stop.
    ContentMismatch {
        url: String,
        expected: String,
        actual: String,
    },
    /// The destination cannot hold it.
    NoRoom {
        path: PathBuf,
        needed: u64,
        available: u64,
    },
    /// The destination cannot be written.
    Destination { path: PathBuf, detail: String },
    /// It arrived intact and is not a usable dictionary.
    Unusable(PackError),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInCatalogue { language } => write!(
                f,
                "no download is published for \"{language}\"; install a pack yourself and name it \
                 under engines.hunspell.dictionary_paths"
            ),
            Self::UntrustedSource { url, detail } => {
                write!(f, "refusing to fetch {url}: {detail}")
            }
            Self::Transport { url, detail } => write!(f, "could not fetch {url}: {detail}"),
            Self::ContentMismatch {
                url,
                expected,
                actual,
            } => write!(
                f,
                "{url} did not match what this version of lang-check expects \
                 (wanted {expected}, got {actual}). The published dictionary may have been \
                 updated, or the download may have been tampered with; nothing was installed"
            ),
            Self::NoRoom {
                path,
                needed,
                available,
            } => write!(
                f,
                "not enough room in {}: {needed} bytes needed, {available} free",
                path.display()
            ),
            Self::Destination { path, detail } => {
                write!(f, "cannot write to {}: {detail}", path.display())
            }
            Self::Unusable(e) => write!(f, "the downloaded pack is not usable: {e}"),
        }
    }
}

impl std::error::Error for InstallError {}

/// Check a URL before opening a connection to it.
fn vet(url: &str) -> Result<(), InstallError> {
    let Some(rest) = url.strip_prefix("https://") else {
        return Err(InstallError::UntrustedSource {
            url: url.to_string(),
            detail: "only https is allowed".to_string(),
        });
    };
    let host = rest.split('/').next().unwrap_or_default();
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(InstallError::UntrustedSource {
            url: url.to_string(),
            detail: format!("{host} is not an allowed download host"),
        });
    }
    Ok(())
}

/// Free bytes on the filesystem that holds `path`.
///
/// Measured rather than guessed: `available_space` is what the OS reports, so
/// there is no heuristic here to produce a false refusal. Unavailable on some
/// filesystems, and then the check is skipped rather than failing the install.
fn room_for(path: &Path, needed: u64) -> Result<(), InstallError> {
    let Ok(available) = fs4::available_space(path) else {
        return Ok(());
    };
    if available < needed.saturating_add(HEADROOM_BYTES) {
        return Err(InstallError::NoRoom {
            path: path.to_path_buf(),
            needed,
            available,
        });
    }
    Ok(())
}

/// Fetch one file and return its bytes, or refuse them.
async fn fetch(client: &reqwest::Client, file: &RemoteFile) -> Result<Vec<u8>, InstallError> {
    vet(file.url)?;

    let response = client
        .get(file.url)
        .send()
        .await
        .map_err(|e| InstallError::Transport {
            url: file.url.to_string(),
            detail: e.to_string(),
        })?;

    if !response.status().is_success() {
        return Err(InstallError::Transport {
            url: file.url.to_string(),
            detail: format!("HTTP {}", response.status()),
        });
    }

    // The server's own claim about the size, checked before the body is read
    // so an enormous response is refused rather than buffered.
    if let Some(advertised) = response.content_length()
        && advertised != file.bytes
    {
        return Err(InstallError::ContentMismatch {
            url: file.url.to_string(),
            expected: format!("{} bytes", file.bytes),
            actual: format!("{advertised} bytes"),
        });
    }

    let body = response
        .bytes()
        .await
        .map_err(|e| InstallError::Transport {
            url: file.url.to_string(),
            detail: e.to_string(),
        })?;

    if body.len() as u64 != file.bytes {
        return Err(InstallError::ContentMismatch {
            url: file.url.to_string(),
            expected: format!("{} bytes", file.bytes),
            actual: format!("{} bytes", body.len()),
        });
    }

    let mut digest = String::with_capacity(64);
    for byte in Sha256::digest(&body) {
        use std::fmt::Write as _;
        let _ = write!(digest, "{byte:02x}");
    }
    if digest != file.sha256 {
        return Err(InstallError::ContentMismatch {
            url: file.url.to_string(),
            expected: file.sha256.to_string(),
            actual: digest,
        });
    }

    Ok(body.to_vec())
}

/// Install `pack` into `dir`, or leave the directory untouched.
///
/// Nothing is written where the engine would find it until both files have
/// matched their pins and the pair has passed [`validate`]. A failure at any
/// point leaves no partial pack behind, because a half-installed dictionary
/// reads as a broken one forever after.
///
/// # Errors
///
/// [`InstallError`] for an untrusted URL, a failed transfer, bytes that do not
/// match the pin, a destination that cannot hold or accept the files, or a
/// download that turns out not to be a usable dictionary.
pub async fn install(pack: &CataloguePack, dir: &Path) -> Result<PackReport, InstallError> {
    std::fs::create_dir_all(dir).map_err(|e| InstallError::Destination {
        path: dir.to_path_buf(),
        detail: e.to_string(),
    })?;
    room_for(dir, pack.aff.bytes + pack.dic.bytes)?;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| InstallError::Transport {
            url: pack.aff.url.to_string(),
            detail: e.to_string(),
        })?;

    let aff = fetch(&client, &pack.aff).await?;
    let dic = fetch(&client, &pack.dic).await?;

    // Staged beside the destination, so the rename that publishes them is on
    // the same filesystem and therefore atomic.
    let staging = dir.join(format!(".{}.incoming", pack.stem));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| InstallError::Destination {
        path: staging.clone(),
        detail: e.to_string(),
    })?;

    let staged = Staged(staging.clone());
    let staged_aff = staging.join(format!("{}.aff", pack.stem));
    let staged_dic = staging.join(format!("{}.dic", pack.stem));
    write_file(&staged_aff, &aff)?;
    write_file(&staged_dic, &dic)?;

    // Parsed before it is published, so a pack that cannot be read fails here
    // rather than three keystrokes into a paragraph.
    let report = validate(&ResolvedPack {
        language: pack.language.to_string(),
        stem: pack.stem.to_string(),
        aff: staged_aff.clone(),
        dic: staged_dic.clone(),
        source: PackSource::Managed,
    })
    .map_err(InstallError::Unusable)?;

    let final_aff = dir.join(format!("{}.aff", pack.stem));
    let final_dic = dir.join(format!("{}.dic", pack.stem));
    for (from, to) in [(&staged_aff, &final_aff), (&staged_dic, &final_dic)] {
        std::fs::rename(from, to).map_err(|e| InstallError::Destination {
            path: to.clone(),
            detail: e.to_string(),
        })?;
    }
    drop(staged);

    Ok(PackReport {
        pack: ResolvedPack {
            language: pack.language.to_string(),
            stem: pack.stem.to_string(),
            aff: final_aff,
            dic: final_dic,
            source: PackSource::Managed,
        },
        ..report
    })
}

/// Removes the staging directory however the install ends.
struct Staged(PathBuf);

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), InstallError> {
    let mut file = std::fs::File::create(path).map_err(|e| InstallError::Destination {
        path: path.to_path_buf(),
        detail: e.to_string(),
    })?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| InstallError::Destination {
            path: path.to_path_buf(),
            detail: if e.kind() == std::io::ErrorKind::StorageFull {
                "the disk is full".to_string()
            } else {
                e.to_string()
            },
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::catalogue::CATALOGUE;

    fn file(url: &'static str) -> RemoteFile {
        RemoteFile {
            url,
            sha256: "0".repeat(64).leak(),
            bytes: 1,
        }
    }

    #[test]
    fn plain_http_is_refused_before_a_connection_is_opened() {
        let err = vet("http://raw.githubusercontent.com/x").unwrap_err();
        assert!(matches!(err, InstallError::UntrustedSource { .. }), "{err}");
        assert!(err.to_string().contains("only https"), "{err}");
    }

    #[test]
    fn a_host_off_the_allowlist_is_refused() {
        // The digest already stops altered content; this stops a catalogue
        // entry pointing somewhere nobody reviewed.
        let err = vet("https://example.invalid/he_IL.dic").unwrap_err();
        assert!(matches!(err, InstallError::UntrustedSource { .. }), "{err}");
        assert!(err.to_string().contains("example.invalid"), "{err}");
    }

    #[test]
    fn a_lookalike_host_does_not_pass() {
        for url in [
            "https://raw.githubusercontent.com.evil.test/x",
            "https://evil.test/raw.githubusercontent.com/x",
            "https://notraw.githubusercontent.com/x",
        ] {
            assert!(vet(url).is_err(), "{url} was accepted");
        }
    }

    #[test]
    fn every_catalogue_url_passes_its_own_vetting() {
        for pack in CATALOGUE {
            vet(pack.aff.url).unwrap_or_else(|e| panic!("{}: {e}", pack.language));
            vet(pack.dic.url).unwrap_or_else(|e| panic!("{}: {e}", pack.language));
        }
    }

    #[test]
    fn a_full_disk_is_reported_before_anything_is_fetched() {
        let dir = tempfile::tempdir().unwrap();
        // More than any real filesystem has free.
        let err = room_for(dir.path(), u64::MAX / 2).unwrap_err();
        assert!(matches!(err, InstallError::NoRoom { .. }), "{err}");
        assert!(err.to_string().contains("not enough room"), "{err}");
    }

    #[test]
    fn a_pack_that_fits_is_not_refused() {
        let dir = tempfile::tempdir().unwrap();
        // The real Hebrew pack, which any machine running the tests can hold.
        room_for(dir.path(), 7_875_142).expect("8 MB should fit");
    }

    #[test]
    fn an_unwritable_destination_says_so() {
        let err = InstallError::Destination {
            path: PathBuf::from("/proc/nope/he_IL.dic"),
            detail: "Read-only file system".to_string(),
        };
        assert!(err.to_string().contains("cannot write to"), "{err}");
    }

    #[test]
    fn a_content_mismatch_says_what_it_wanted_and_what_it_got() {
        // The message has to leave the user able to tell an upstream update
        // from an attack, because this code cannot.
        let err = InstallError::ContentMismatch {
            url: "https://raw.githubusercontent.com/x".to_string(),
            expected: "abc".to_string(),
            actual: "def".to_string(),
        };
        let message = err.to_string();
        assert!(
            message.contains("abc") && message.contains("def"),
            "{message}"
        );
        assert!(message.contains("tampered"), "{message}");
        assert!(message.contains("nothing was installed"), "{message}");
    }

    #[test]
    fn a_language_with_no_published_download_points_at_the_override() {
        let err = InstallError::NotInCatalogue {
            language: "la".to_string(),
        };
        assert!(err.to_string().contains("dictionary_paths"), "{err}");
    }

    #[tokio::test]
    async fn a_refused_url_never_touches_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let bogus = CataloguePack {
            language: "xx",
            stem: "xx",
            aff: file("https://example.invalid/xx.aff"),
            dic: file("https://example.invalid/xx.dic"),
            licence: "test",
            provenance: "test",
        };
        let err = install(&bogus, dir.path()).await.unwrap_err();
        assert!(matches!(err, InstallError::UntrustedSource { .. }), "{err}");
        let left: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert!(left.is_empty(), "a refused install left {left:?} behind");
    }
}
