//! Compile the gazetteer word list produced by `scripts/build-name-gazetteer.py`
//! into the FST that ships inside the binary.
//!
//! Kept as an example rather than a `[[bin]]` so it never lands in a release
//! artifact, and out of `build.rs` so a 100k-key FST build isn't paid on every
//! compile. The generated `.fst` is committed; re-run this only when the word list
//! changes.
//!
//! ```sh
//! cargo run --example build-name-fst -- \
//!     dictionaries/names/names.txt dictionaries/names/names.fst
//! ```

use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let [_, input, output] = args.as_slice() else {
        eprintln!("usage: build-name-fst <names.txt> <names.fst>");
        std::process::exit(2);
    };

    let reader = BufReader::new(File::open(input)?);
    let mut names: Vec<String> = reader
        .lines()
        .map(|line| line.map(|l| l.trim().to_owned()))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect();

    // `SetBuilder::insert` requires strictly increasing byte order; the generator
    // already sorts, but sorting here keeps the example correct standalone.
    names.sort_unstable();
    names.dedup();

    let mut builder = fst::SetBuilder::new(BufWriter::new(File::create(output)?))?;
    for name in &names {
        builder.insert(name)?;
    }
    builder.finish()?;

    let bytes = std::fs::metadata(output)?.len();
    println!(
        "wrote {} names to {output} ({bytes} bytes, {:.1}% of the {} byte word list)",
        names.len(),
        bytes as f64 / std::fs::metadata(input)?.len() as f64 * 100.0,
        std::fs::metadata(input)?.len()
    );
    Ok(())
}
