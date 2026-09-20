//! Issue #88: what a typing session costs through the shipped orchestrator.
//!
//! Each iteration is one debounce window — the whole document re-extracted and
//! re-checked, as `CheckProse` does it.

use std::time::Instant;

use lang_check::config::Config;
use lang_check::orchestrator::Orchestrator;
use lang_check::prose;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: perf_session <file> [lt_url] [edits]");
    let lt_url = args
        .next()
        .unwrap_or_else(|| "http://localhost:8010".into());
    let edits: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(10);

    let base = std::fs::read_to_string(&path)?;
    let insert_at = base[..base.len() * 2 / 3]
        .rfind(". ")
        .map_or(base.len() / 2, |i| i + 2);

    for (label, cache_entries, request_bytes) in [
        ("per-range, no cache", 0usize, 0usize),
        ("packed, no cache", 0, 4096),
        ("packed + cache", 4096, 4096),
    ] {
        let mut config = Config::default();
        config.engines.harper.enabled = false;
        config.engines.languagetool.enabled = true;
        config.engines.languagetool.url = lt_url.clone();
        config.engines.languagetool.max_request_bytes = request_bytes;
        config.engines.spell_language = "en-US".to_string();
        config.performance.result_cache_entries = cache_entries;
        let mut orchestrator = Orchestrator::new(config);

        // One warm pass so the JVM is not being measured.
        let ranges = prose::extract_with_fallback(
            &base,
            "typst",
            None,
            None,
            &prose::latex::LatexExtras::default(),
        )?;
        let spell_language = orchestrator.get_config().engines.spell_language.clone();
        let _ = orchestrator
            .check_units(&prose::range_units(&ranges, &base, &spell_language))
            .await;

        let mut total = 0.0f64;
        let mut diagnostics = 0usize;
        let mut ranges_seen = 0usize;
        for e in 0..edits {
            let mut text = base.clone();
            text.insert_str(insert_at, &format!("word{e} "));
            let t = Instant::now();
            let ranges = prose::extract_with_fallback(
                &text,
                "typst",
                None,
                None,
                &prose::latex::LatexExtras::default(),
            )?;
            let batch = orchestrator
                .check_units(&prose::range_units(&ranges, &text, &spell_language))
                .await?;
            total += t.elapsed().as_secs_f64() * 1000.0;
            diagnostics = batch.iter().map(Vec::len).sum();
            ranges_seen = batch.len();
        }
        println!(
            "{label:<22} {:>8.1} ms/edit   ({ranges_seen} ranges, {diagnostics} diagnostics)",
            total / edits as f64
        );
    }
    Ok(())
}
