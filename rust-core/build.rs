fn main() {
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
