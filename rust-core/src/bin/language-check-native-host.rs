//! Native messaging host for the LangCheck browser extension.
//!
//! Started by the browser, never by hand: it relays the extension's requests
//! to `language-check-server` (see `lang_check::native_host`). `install`
//! writes the manifest that tells a browser where this binary is.

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use lang_check::native_host::{self, Browser};

#[derive(Parser)]
#[command(
    version,
    about = "Native messaging host for the LangCheck browser extension"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// What the browser passes when it starts the host (the manifest path
    /// and add-on id in Firefox, the caller's origin in Chrome). Unused.
    #[arg(hide = true, trailing_var_arg = true, allow_hyphen_values = true)]
    launcher_args: Vec<String>,
}

#[derive(Subcommand)]
enum Command {
    /// Register this binary with a browser by writing its host manifest.
    Install {
        #[arg(long, value_enum)]
        browser: Browser,
        /// The unpacked extension's id, shown on chrome://extensions.
        #[arg(long)]
        chrome_extension_id: Option<String>,
        /// Write the manifest here instead of the browser's user directory
        /// (a test profile's `NativeMessagingHosts`, for instance).
        #[arg(long)]
        dir: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Install {
            browser,
            chrome_extension_id,
            dir,
        }) => install(browser, chrome_extension_id.as_deref(), dir),
        None => {
            let runtime = tokio::runtime::Runtime::new()?;
            let outcome = runtime.block_on(native_host::run(
                &native_host::sibling_server()?,
                &native_host::default_web_root()?,
                tokio::io::stdin(),
                tokio::io::stdout(),
            ));
            // tokio reads stdin on a blocking thread, and dropping a runtime
            // waits for those. When the server dies with the browser's port
            // still open, that read never returns, so the host would outlive
            // its server. Leave the thread behind instead; the process exits.
            runtime.shutdown_background();
            outcome
        }
    }
}

fn install(
    browser: Browser,
    chrome_extension_id: Option<&str>,
    dir: Option<PathBuf>,
) -> Result<()> {
    let exe = std::env::current_exe()?.canonicalize()?;
    let server = native_host::sibling_server()?;
    if !server.is_file() {
        anyhow::bail!(
            "{} is missing; the host needs the server next to it",
            server.display()
        );
    }
    let manifest = native_host::manifest(&exe, browser, chrome_extension_id)?;
    let dir = match dir {
        Some(dir) => dir,
        None => native_host::manifest_dir(browser)?,
    };
    std::fs::create_dir_all(&dir).with_context(|| format!("cannot create {}", dir.display()))?;
    let path = dir.join(format!("{}.json", native_host::HOST_NAME));
    std::fs::write(&path, serde_json::to_string_pretty(&manifest)? + "\n")
        .with_context(|| format!("cannot write {}", path.display()))?;
    println!("wrote {}", path.display());
    Ok(())
}
