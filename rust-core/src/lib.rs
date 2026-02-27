#![warn(clippy::pedantic, clippy::nursery)]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::module_name_repetitions
)]

pub mod checker {
    #![allow(clippy::pedantic, clippy::nursery, clippy::all, clippy::restriction)]
    include!(concat!(env!("OUT_DIR"), "/languagecheck.rs"));
}

pub mod cache;
pub mod config;
pub mod dictionary;
pub mod engines;
pub mod hashing;
pub mod insights;
pub mod orchestrator;
pub mod prose;
pub mod rules;
pub mod scoping;
pub mod workspace;
