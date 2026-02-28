fn main() {
    prost_build::Config::new()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&["../proto/checker.proto"], &["../proto"])
        .unwrap();

    // Compile vendored tree-sitter-forester parser
    let dir = std::path::Path::new("tree-sitter-forester/src");
    cc::Build::new()
        .include(dir)
        .file(dir.join("parser.c"))
        .file(dir.join("scanner.c"))
        .warnings(false)
        .compile("tree_sitter_forester");

    // Compile vendored tree-sitter-tinylang parser
    let dir = std::path::Path::new("tree-sitter-tinylang/src");
    cc::Build::new()
        .include(dir)
        .file(dir.join("parser.c"))
        .file(dir.join("scanner.c"))
        .warnings(false)
        .compile("tree_sitter_tinylang");

    // Compile vendored tree-sitter-org parser
    let dir = std::path::Path::new("tree-sitter-org/src");
    cc::Build::new()
        .include(dir)
        .file(dir.join("parser.c"))
        .file(dir.join("scanner.c"))
        .warnings(false)
        .compile("tree_sitter_org");
}
