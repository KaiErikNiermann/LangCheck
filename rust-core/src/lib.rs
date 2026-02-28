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
pub mod detection;
pub mod dictionary;
pub mod document;
pub mod engines;
pub mod feedback;
pub mod forester_ts;
pub mod hashing;
pub mod ignore_rules;
pub mod insights;
pub mod languages;
pub mod orchestrator;
pub mod org_ts;
pub mod prose;
pub mod rules;
pub mod scoping;
pub mod sls;
pub mod style_rules;
pub mod tinylang_ts;
pub mod workspace;
