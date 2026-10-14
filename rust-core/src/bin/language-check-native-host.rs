//! Native messaging host for the LangCheck browser extension.
//!
//! Started by the browser, never by hand: it relays the extension's requests
//! to `language-check-server` (see `lang_check::native_host`). `install`
//! writes the manifest that tells a browser where this binary is; `doctor`
//! says whether each browser's manifest leads to a host that can start.

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
    /// Say whether each browser can start this host, and what to do if not.
    Doctor,
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
        Some(Command::Doctor) => doctor(),
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
    if exe.components().any(|part| part.as_os_str() == "debug") {
        println!(
            "note: this is a debug build; `cargo clean` deletes it and the browser then cannot \
             start the host. A release build (target/release) is the steadier one to register."
        );
    }
    Ok(())
}

/// What `doctor` found for one browser's manifest.
enum Finding {
    Ok(String),
    Problem(String),
    /// No manifest: the browser is simply not set up, which is not a fault on its own.
    Absent,
}

fn doctor() -> Result<()> {
    let exe = std::env::current_exe()?.canonicalize()?;
    println!("host:   {}", exe.display());
    let server = native_host::sibling_server()?;
    let server_ok = is_executable(&server);
    println!(
        "server: {} ({})",
        server.display(),
        if server_ok {
            "ok"
        } else {
            "MISSING: the host starts it from its own directory"
        }
    );
    let mut problems = usize::from(!server_ok);
    let mut registered = 0;
    for browser in [Browser::Firefox, Browser::Chrome, Browser::Chromium] {
        let name = format!("{browser:?}").to_lowercase();
        match check_manifest(browser, &exe) {
            Finding::Ok(detail) => {
                registered += 1;
                println!("{name}: ok ({detail})");
            }
            Finding::Problem(detail) => {
                registered += 1;
                problems += 1;
                println!("{name}: PROBLEM: {detail}");
                println!("  fix: language-check-native-host install --browser {name}");
            }
            Finding::Absent => println!("{name}: not registered"),
        }
    }
    if registered == 0 {
        problems += 1;
        println!(
            "No browser is registered. Run `language-check-native-host install --browser firefox` (or chrome)."
        );
    }
    if problems > 0 {
        anyhow::bail!("{problems} problem(s) found");
    }
    Ok(())
}

fn check_manifest(browser: Browser, exe: &std::path::Path) -> Finding {
    let Ok(dir) = native_host::manifest_dir(browser) else {
        return Finding::Absent;
    };
    let path = dir.join(format!("{}.json", native_host::HOST_NAME));
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Finding::Absent;
    };
    let manifest: serde_json::Value = match serde_json::from_str(&text) {
        Ok(manifest) => manifest,
        Err(e) => return Finding::Problem(format!("{} is not valid JSON: {e}", path.display())),
    };
    if let Some(problem) = native_host::manifest_problem(&manifest, browser) {
        return Finding::Problem(format!("{}: {problem}", path.display()));
    }
    let Some(host) = manifest.get("path").and_then(serde_json::Value::as_str) else {
        return Finding::Problem(format!("{} names no host path", path.display()));
    };
    let host = PathBuf::from(host);
    if !is_executable(&host) {
        return Finding::Problem(format!(
            "{} points at {}, which does not exist or cannot run (a `cargo clean`, or a moved checkout?)",
            path.display(),
            host.display()
        ));
    }
    let sibling = host.with_file_name(if cfg!(windows) {
        "language-check-server.exe"
    } else {
        "language-check-server"
    });
    if !is_executable(&sibling) {
        return Finding::Problem(format!(
            "{} has no language-check-server beside it",
            host.display()
        ));
    }
    if host.canonicalize().ok().as_deref() == Some(exe) {
        Finding::Ok(format!("{} -> this host", path.display()))
    } else {
        Finding::Ok(format!(
            "{} -> {}, not this one",
            path.display(),
            host.display()
        ))
    }
}

fn is_executable(path: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}
