//! A workspace config's `engines.external` runs only in a trusted workspace.
//!
//! Drives `language-check-server --lsp` the way Neovim does. The config names
//! `/bin/sh` as an external provider that leaves a marker file behind, so
//! whether the program ran is read off the disk rather than off the server's
//! own account of it.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// Long enough for a cold debug build to load its dictionaries.
const DEADLINE: Duration = Duration::from_secs(120);

struct Server {
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Value>,
}

impl Server {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_language-check-server"))
            .arg("--lsp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let (sender, messages) = channel();
        std::thread::spawn(move || {
            loop {
                let mut length = None;
                loop {
                    let mut line = String::new();
                    if stdout.read_line(&mut line).unwrap_or(0) == 0 {
                        return;
                    }
                    let line = line.trim_end();
                    if line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.strip_prefix("Content-Length: ") {
                        length = value.parse::<usize>().ok();
                    }
                }
                let mut body = vec![0; length.unwrap()];
                stdout.read_exact(&mut body).unwrap();
                if sender.send(serde_json::from_slice(&body).unwrap()).is_err() {
                    return;
                }
            }
        });
        Self {
            child,
            stdin,
            messages,
        }
    }

    fn send(&mut self, message: &Value) {
        let body = message.to_string();
        write!(self.stdin, "Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        self.stdin.flush().unwrap();
    }

    /// Every message up to and including the first that `done` accepts.
    fn until(&self, done: impl Fn(&Value) -> bool) -> Vec<Value> {
        let start = Instant::now();
        let mut seen = Vec::new();
        loop {
            let left = DEADLINE.saturating_sub(start.elapsed());
            let message = self
                .messages
                .recv_timeout(left)
                .unwrap_or_else(|_| panic!("no matching message within {DEADLINE:?}: {seen:#?}"));
            let finished = done(&message);
            seen.push(message);
            if finished {
                return seen;
            }
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Open `a.md` in a workspace whose config names an external provider, and
/// return whether the provider ran, every message the server sent, and the
/// server, still running.
fn open_with(workspace: &Path, options: Option<Value>) -> (bool, Vec<Value>, Server) {
    let marker = workspace.join("RAN");
    std::fs::write(
        workspace.join(".languagecheck.yaml"),
        format!(
            "engines:\n  external:\n    - name: probe\n      command: /bin/sh\n      \
             args: ['-c', 'touch \"{}\"; echo []']\n",
            marker.display()
        ),
    )
    .unwrap();
    let document = workspace.join("a.md");
    std::fs::write(&document, "Hello world.\n").unwrap();
    let uri = format!("file://{}", document.display());

    let mut server = Server::start();
    let mut params = json!({
        "processId": null,
        "rootUri": format!("file://{}", workspace.display()),
        "capabilities": {},
    });
    if let Some(options) = options {
        params["initializationOptions"] = options;
    }
    server.send(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": params}));
    let mut seen = server.until(|m| m["id"] == 1);
    server.send(&json!({"jsonrpc": "2.0", "method": "initialized", "params": {}}));
    server.send(&json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {"textDocument": {
            "uri": uri, "languageId": "markdown", "version": 1, "text": "Hello world.\n",
        }},
    }));
    // The document's diagnostics arrive after every engine has answered, so
    // by then the provider has run if it was going to.
    seen.extend(server.until(|m| {
        m["method"] == "textDocument/publishDiagnostics" && m["params"]["uri"] == uri.as_str()
    }));
    (marker.exists(), seen, server)
}

fn is_warning(m: &Value) -> bool {
    m["method"] == "window/showMessage"
        && m["params"]["message"]
            .as_str()
            .is_some_and(|text| text.contains("engines.external"))
}

fn warned(seen: &[Value]) -> bool {
    seen.iter().any(is_warning)
}

#[test]
fn a_workspace_config_runs_no_program_without_trust() {
    let workspace = tempfile::tempdir().unwrap();
    let (ran, seen, server) = open_with(workspace.path(), None);
    assert!(!ran, "the workspace's external provider ran");
    // Sent on `initialized`, which need not come out ahead of the
    // diagnostics; `until` fails the test if it never comes.
    if !warned(&seen) {
        server.until(is_warning);
    }
}

#[test]
fn trust_workspace_false_is_not_trust() {
    let workspace = tempfile::tempdir().unwrap();
    let (ran, _, _server) = open_with(workspace.path(), Some(json!({"trustWorkspace": false})));
    assert!(!ran, "the workspace's external provider ran");
}

#[test]
fn a_trusted_workspace_config_runs_its_program() {
    let workspace = tempfile::tempdir().unwrap();
    let (ran, seen, _server) = open_with(workspace.path(), Some(json!({"trustWorkspace": true})));
    assert!(ran, "the trusted workspace's external provider did not run");
    assert!(!warned(&seen), "a trusted workspace was warned: {seen:#?}");
}
