//! The browser's native messaging host, spoken to as a browser would: JSON
//! messages with a native-endian length prefix, protobuf inside, against the
//! real host and server binaries. `XDG_DATA_HOME` points at a temp dir, so
//! the web workspaces and the server's databases land there.

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use lang_check::checker::{
    AddDictionaryWordRequest, CheckRequest, InitializeRequest, Request, Response,
    WriteConfigRequest, request, response,
};
use prost::Message;

struct Host {
    child: Child,
    _data: tempfile::TempDir,
}

impl Host {
    fn start() -> Self {
        Self::start_from(env!("CARGO_BIN_EXE_language-check-native-host").as_ref())
    }

    fn start_from(exe: &std::path::Path) -> Self {
        let data = tempfile::tempdir().expect("temp dir");
        let child = Command::new(exe)
            // What Firefox passes; the host must ignore it.
            .args([
                "/home/u/.mozilla/native-messaging-hosts/language_check.json",
                "language-check@kaierikniermann.github.io",
            ])
            .env("XDG_DATA_HOME", data.path())
            .env("RUST_LOG", "warn")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the host binary runs");
        Self { child, _data: data }
    }

    fn send_raw(&mut self, body: &[u8]) {
        let stdin = self.child.stdin.as_mut().expect("stdin");
        stdin
            .write_all(&u32::try_from(body.len()).unwrap().to_ne_bytes())
            .unwrap();
        stdin.write_all(body).unwrap();
        stdin.flush().unwrap();
    }

    fn send(&mut self, id: u64, payload: request::Payload) {
        let frame = BASE64.encode(
            Request {
                id,
                payload: Some(payload),
            }
            .encode_to_vec(),
        );
        self.send_raw(serde_json::json!({ "frame": frame }).to_string().as_bytes());
    }

    fn receive(&mut self) -> Response {
        let stdout = self.child.stdout.as_mut().expect("stdout");
        let mut joined = String::new();
        loop {
            let mut len = [0u8; 4];
            stdout.read_exact(&mut len).expect("a message header");
            let len = u32::from_ne_bytes(len) as usize;
            assert!(
                len <= 1024 * 1024,
                "browsers refuse host messages over 1 MiB, got {len}"
            );
            let mut body = vec![0u8; len];
            stdout.read_exact(&mut body).expect("a message body");
            let message: serde_json::Value = serde_json::from_slice(&body).expect("JSON");
            joined.push_str(message["frame"].as_str().expect("a frame"));
            if !message["more"].as_bool().expect("a more flag") {
                break;
            }
        }
        Response::decode(BASE64.decode(joined).expect("base64").as_slice()).expect("a response")
    }

    fn initialize(&mut self, key: &str) {
        self.send(
            1,
            request::Payload::Initialize(InitializeRequest {
                workspace_root: key.into(),
                ..Default::default()
            }),
        );
        let response = self.receive();
        assert!(
            matches!(response.payload, Some(response::Payload::Initialize(_))),
            "{response:?}"
        );
    }

    fn check(&mut self, id: u64, text: &str) -> Vec<String> {
        self.send(
            id,
            request::Payload::CheckProse(CheckRequest {
                text: text.into(),
                language_id: "markdown".into(),
                ..Default::default()
            }),
        );
        let response = self.receive();
        assert_eq!(response.id, id);
        let Some(response::Payload::CheckProse(check)) = response.payload else {
            panic!("expected a check response, got {response:?}");
        };
        check
            .diagnostics
            .iter()
            .map(|d| text[d.start_byte as usize..d.end_byte as usize].to_owned())
            .collect()
    }

    fn wait_exit(&mut self, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if self.child.try_wait().expect("try_wait").is_some() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

#[test]
fn checks_learns_a_word_and_rechecks_through_the_host() {
    let mut host = Host::start();
    host.initialize("test-project");
    let text = "I will recieve the parcel tomorrow.";
    assert!(host.check(2, text).contains(&"recieve".to_owned()));

    host.send(
        3,
        request::Payload::AddDictionaryWord(AddDictionaryWordRequest {
            word: "recieve".into(),
        }),
    );
    let added = host.receive();
    assert_eq!(added.id, 3);
    assert!(
        matches!(added.payload, Some(response::Payload::Ok(_))),
        "{added:?}"
    );

    assert!(!host.check(4, text).contains(&"recieve".to_owned()));
}

#[test]
fn refusals_come_back_under_the_request_id_and_the_host_keeps_serving() {
    let mut host = Host::start();
    host.send(
        5,
        request::Payload::Initialize(InitializeRequest {
            workspace_root: "../../etc".into(),
            ..Default::default()
        }),
    );
    let refused = host.receive();
    assert_eq!(refused.id, 5);
    assert!(matches!(refused.payload, Some(response::Payload::Error(_))));

    // A config larger than the host writes.
    host.send(
        6,
        request::Payload::WriteConfig(WriteConfigRequest {
            text: "#".repeat(lang_check::config::Config::MAX_TEXT_BYTES + 1),
        }),
    );
    let refused = host.receive();
    assert_eq!(refused.id, 6);
    assert!(matches!(refused.payload, Some(response::Payload::Error(_))));

    host.send_raw(b"{ not json");
    assert!(matches!(
        host.receive().payload,
        Some(response::Payload::Error(_))
    ));

    host.initialize("still-serving");
    assert!(host.check(7, "Teh end.").iter().any(|w| w == "Teh"));
}

#[test]
fn closing_the_port_ends_host_and_server() {
    let mut host = Host::start();
    host.initialize("closing");
    drop(host.child.stdin.take());
    assert!(
        host.wait_exit(Duration::from_secs(10)),
        "host outlived its port"
    );
}

#[test]
fn an_impossible_length_ends_the_host_instead_of_waiting() {
    let mut host = Host::start();
    let stdin = host.child.stdin.as_mut().unwrap();
    stdin.write_all(&u32::MAX.to_ne_bytes()).unwrap();
    stdin.flush().unwrap();
    assert!(
        host.wait_exit(Duration::from_secs(10)),
        "host waited for 4 GiB that will never come"
    );
}

/// The server crashing while the browser keeps its port open must end the
/// host, so the extension sees a disconnect and starts a fresh one. Before the
/// host aborted its browser reader, this held the host open forever.
#[cfg(target_os = "linux")]
#[test]
fn a_server_crash_ends_the_host_while_the_port_is_open() {
    let mut host = Host::start();
    host.initialize("crash");
    let children = std::fs::read_dir(format!("/proc/{}/task", host.child.id()))
        .unwrap()
        .filter_map(|task| std::fs::read_to_string(task.unwrap().path().join("children")).ok())
        .flat_map(|list| {
            list.split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        children.len(),
        1,
        "expected one server child, found {children:?}"
    );
    let killed = Command::new("kill")
        .args(["-9", &children[0]])
        .status()
        .unwrap();
    assert!(killed.success());
    assert!(
        host.wait_exit(Duration::from_secs(10)),
        "host outlived its server"
    );
}

/// A host with no server beside it answers each request with why, instead
/// of exiting, which Firefox reports only as "An unexpected error occurred".
#[test]
fn a_host_without_its_server_says_so_and_keeps_answering() {
    let alone = tempfile::tempdir().expect("temp dir");
    let exe = alone.path().join("language-check-native-host");
    std::fs::copy(env!("CARGO_BIN_EXE_language-check-native-host"), &exe).unwrap();
    let mut host = Host::start_from(&exe);
    for id in [1, 2] {
        host.send(
            id,
            request::Payload::Initialize(InitializeRequest {
                workspace_root: "alone".into(),
                ..Default::default()
            }),
        );
        let response = host.receive();
        assert_eq!(response.id, id);
        let Some(response::Payload::Error(error)) = response.payload else {
            panic!("expected an error, got {response:?}");
        };
        assert!(
            error.message.contains("cannot start language-check-server")
                && error.message.contains("doctor"),
            "{}",
            error.message
        );
    }
}
