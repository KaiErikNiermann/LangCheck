pub mod checker {
    include!(concat!(env!("OUT_DIR"), "/languagecheck.rs"));
}

pub mod prose;
pub mod engines;
pub mod orchestrator;
pub mod rules;
pub mod hashing;
pub mod workspace;
pub mod config;
pub mod insights;
