fn main() {
    prost_build::Config::new()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&["../proto/checker.proto"], &["../proto"])
        .unwrap();

    // Compile vendored tree-sitter parsers.
    // rerun-if-changed ensures cargo rebuilds the C libs when grammar is regenerated.
    for name in ["forester", "tinylang", "org"] {
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
}
