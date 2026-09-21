use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// A digest of this crate's own sources, for the stored-result fingerprint.
///
/// A stored check result is only reusable by a core that would compute the
/// same answer. The crate version does not move between builds of a version
/// in progress, so without this a change to how a diagnostic is placed lands,
/// the core is rebuilt, and the editor goes on drawing the previous span out
/// of the workspace index -- while the CLI, which keeps no index, shows the
/// new one. That is a day lost to a bug that is not in the code.
///
/// Content-addressed, not a timestamp: the same sources produce the same id,
/// so rebuilding an unchanged checkout keeps every stored result.
fn source_digest() -> u64 {
    fn walk(dir: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, files);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                files.push(path);
            }
        }
    }

    let mut files = Vec::new();
    walk(std::path::Path::new("src"), &mut files);
    files.sort();

    let mut hasher = DefaultHasher::new();
    for file in &files {
        file.to_string_lossy().hash(&mut hasher);
        if let Ok(bytes) = std::fs::read(file) {
            bytes.hash(&mut hasher);
        }
    }
    hasher.finish()
}

fn main() {
    // Any source change gives the build a new identity, which is what retires
    // the results a previous build stored. See `source_digest`.
    println!("cargo:rerun-if-changed=src");
    println!(
        "cargo:rustc-env=LANG_CHECK_BUILD_ID={:016x}",
        source_digest()
    );

    // Proto file: try local copy first (crates.io tarball), then workspace path.
    let (proto, include) = if std::path::Path::new("proto/checker.proto").exists() {
        ("proto/checker.proto", "proto")
    } else {
        ("../proto/checker.proto", "../proto")
    };
    println!("cargo:rerun-if-changed={proto}");
    prost_build::Config::new()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&[proto], &[include])
        .unwrap();

    // Compile vendored tree-sitter parsers.
    // rerun-if-changed ensures cargo rebuilds the C libs when grammar is regenerated.
    for name in ["forester", "tinylang", "org", "typst"] {
        let dir = format!("tree-sitter-{name}/src");
        let parser = format!("{dir}/parser.c");
        let scanner = format!("{dir}/scanner.c");
        println!("cargo:rerun-if-changed={parser}");
        println!("cargo:rerun-if-changed={scanner}");
        cc::Build::new()
            .include(&dir)
            .file(&parser)
            .file(&scanner)
            .warnings(false)
            .compile(&format!("tree_sitter_{name}"));
    }

    // bibtex: parser only, no scanner
    {
        let dir = "tree-sitter-bibtex/src";
        let parser = format!("{dir}/parser.c");
        println!("cargo:rerun-if-changed={parser}");
        cc::Build::new()
            .include(dir)
            .file(&parser)
            .warnings(false)
            .compile("tree_sitter_bibtex");
    }
}
