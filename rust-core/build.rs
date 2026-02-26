fn main() {
    prost_build::compile_protos(&["../proto/checker.proto"], &["../proto"]).unwrap();
}
