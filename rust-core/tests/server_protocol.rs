//! The server's framing, spoken to the real binary over its stdio.
//!
//! What the editor relies on when something arrives that is not a proper
//! request: an undecodable one is answered under its own id, so the editor
//! fails that request at once, and a length no request could have ends the
//! process, so the editor starts a fresh one instead of waiting on a stream
//! that is out of step. And a second server on a workspace whose index is
//! taken says so, and by which process, rather than failing Initialize.

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use lang_check::checker::{
    CheckRequest, InitializeRequest, InitializeResponse, MetadataRequest, Request, Response,
    request, response,
};
use prost::Message;

fn server() -> Child {
    Command::new(env!("CARGO_BIN_EXE_language-check-server"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("the server binary runs")
}

fn send_frame(child: &mut Child, body: &[u8]) {
    let stdin = child.stdin.as_mut().expect("stdin");
    let length = u32::try_from(body.len()).expect("a small frame");
    stdin
        .write_all(&length.to_be_bytes())
        .expect("write length");
    stdin.write_all(body).expect("write body");
    stdin.flush().expect("flush");
}

fn read_response(child: &mut Child) -> Response {
    let stdout = child.stdout.as_mut().expect("stdout");
    let mut length = [0u8; 4];
    stdout.read_exact(&mut length).expect("a response header");
    let mut body = vec![0u8; u32::from_be_bytes(length) as usize];
    stdout.read_exact(&mut body).expect("a response body");
    Response::decode(body.as_slice()).expect("a decodable response")
}

#[test]
fn a_well_formed_request_is_answered() {
    let mut child = server();
    let request = Request {
        id: 7,
        payload: Some(request::Payload::GetMetadata(MetadataRequest {})),
    };
    send_frame(&mut child, &request.encode_to_vec());
    let response = read_response(&mut child);
    assert_eq!(response.id, 7);
    assert!(matches!(
        response.payload,
        Some(response::Payload::GetMetadata(_))
    ));
    child.kill().ok();
}

#[test]
fn an_undecodable_request_is_answered_under_its_own_id() {
    let mut child = server();
    let mut body = Request {
        id: 300,
        payload: None,
    }
    .encode_to_vec();
    // A field that claims more bytes than follow.
    body.extend_from_slice(&[0x12, 0x7f, 0x01]);
    send_frame(&mut child, &body);
    let response = read_response(&mut child);
    assert_eq!(
        response.id, 300,
        "filed under 0, the editor waits out its timeout"
    );
    assert!(matches!(
        response.payload,
        Some(response::Payload::Error(_))
    ));
    child.kill().ok();
}

#[test]
fn a_length_no_request_could_have_ends_the_process() {
    let mut child = server();
    // "2026" read as a length, as a stray line on the wrong stream would be.
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(b"2026-09-23 not a frame\n")
        .expect("write");
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.try_wait().expect("wait") {
            assert!(!status.success(), "exited, but claimed success");
            return;
        }
        assert!(
            Instant::now() < deadline,
            "still waiting for 842 MB that will never come"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn initialize(
    child: &mut Child,
    root: &std::path::Path,
    db: &std::path::Path,
) -> InitializeResponse {
    let request = Request {
        id: 1,
        payload: Some(request::Payload::Initialize(InitializeRequest {
            workspace_root: root.to_string_lossy().into_owned(),
            db_path: Some(db.to_string_lossy().into_owned()),
            ..Default::default()
        })),
    };
    send_frame(child, &request.encode_to_vec());
    match read_response(child).payload {
        Some(response::Payload::Initialize(answer)) => answer,
        other => panic!("Initialize answered {other:?}"),
    }
}

#[test]
fn a_second_server_on_a_workspace_names_the_first() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("index.redb");
    let mut first = server();
    let mut second = server();

    let first_answer = initialize(&mut first, dir.path(), &db);
    assert_eq!(first_answer.warnings, Vec::<String>::new());
    assert_eq!(first_answer.other_server, None);
    let first_pid = first.id();
    assert_eq!(
        first_answer.this_server.expect("names itself").pid,
        first_pid
    );

    let second_answer = initialize(&mut second, dir.path(), &db);
    let other = second_answer
        .other_server
        .expect("names the server holding the index");
    assert_eq!(other.pid, first_pid);
    assert!(
        !other.executable.is_empty(),
        "the path is what tells two copies apart"
    );
    assert_eq!(
        second_answer.this_server.expect("names itself").pid,
        second.id()
    );
    assert_eq!(
        second_answer.warnings.len(),
        1,
        "{:?}",
        second_answer.warnings
    );
    assert!(second_answer.warnings[0].contains(&first_pid.to_string()));

    first.kill().ok();
    second.kill().ok();
}

#[test]
fn a_server_initialized_twice_does_not_mistake_itself_for_another() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("index.redb");
    let mut child = server();
    initialize(&mut child, dir.path(), &db);
    let again = initialize(&mut child, dir.path(), &db);
    assert_eq!(again.warnings, Vec::<String>::new());
    assert_eq!(again.other_server, None);
    child.kill().ok();
}

fn send_initialize(child: &mut Child, id: u64, root: &std::path::Path, db: &std::path::Path) {
    let request = Request {
        id,
        payload: Some(request::Payload::Initialize(InitializeRequest {
            workspace_root: root.to_string_lossy().into_owned(),
            db_path: Some(db.to_string_lossy().into_owned()),
            ..Default::default()
        })),
    };
    send_frame(child, &request.encode_to_vec());
}

#[test]
fn an_initialize_sent_during_another_does_not_mistake_the_server_for_another() {
    // An editor re-initializes on each config write, so two writes close
    // together send the second Initialize while the first is still loading.
    // Handled at once, the second found the index open in the first and named
    // its own process as the other server; seen in the scope e2e with the
    // second request 11 ms behind the first.
    //
    // On disk, not in /tmp: the window is the index's first commit, and on a
    // tmpfs its fsync is free and the window all but closes.
    let dir = tempfile::tempdir_in(env!("CARGO_TARGET_TMPDIR")).expect("tempdir");
    let db = dir.path().join("index.redb");
    std::fs::write(
        dir.path().join(".languagecheck.yaml"),
        "engines:\n  harper: true\n  spell_language: \"en-US\"\n",
    )
    .expect("write config");
    let mut child = server();
    initialize(&mut child, dir.path(), &db);

    // The gap sweeps the whole of the first Initialize (about 50 ms).
    for round in 0..80 {
        let id = 100 + round * 2;
        send_initialize(&mut child, id, dir.path(), &db);
        std::thread::sleep(Duration::from_micros(750 * round));
        send_initialize(&mut child, id + 1, dir.path(), &db);
        for _ in 0..2 {
            let response = read_response(&mut child);
            let Some(response::Payload::Initialize(answer)) = response.payload else {
                panic!("Initialize {} answered {:?}", response.id, response.payload);
            };
            assert_eq!(
                (answer.other_server, answer.warnings),
                (None, Vec::<String>::new()),
                "Initialize {} (gap {} us) took its own server for another",
                response.id,
                750 * round,
            );
        }
    }
    child.kill().ok();
}

/// Every response the server writes, read on a thread of its own so a test
/// can wait for one with a deadline instead of hanging with the server.
fn responses(child: &mut Child) -> std::sync::mpsc::Receiver<Response> {
    let mut stdout = child.stdout.take().expect("stdout");
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        loop {
            let mut length = [0u8; 4];
            if stdout.read_exact(&mut length).is_err() {
                return;
            }
            let mut body = vec![0u8; u32::from_be_bytes(length) as usize];
            if stdout.read_exact(&mut body).is_err() {
                return;
            }
            let response = Response::decode(body.as_slice()).expect("a decodable response");
            if sender.send(response).is_err() {
                return;
            }
        }
    });
    receiver
}

#[test]
fn a_check_after_overlapping_initializes_is_answered() {
    // In the scope e2e, two Initializes 11 ms apart were followed by checks
    // that the core never answered: the next Initialize then waited forever
    // for the engines, and the editor saw a file that was never checked again.
    let dir = tempfile::tempdir_in(env!("CARGO_TARGET_TMPDIR")).expect("tempdir");
    let db = dir.path().join("index.redb");
    std::fs::write(
        dir.path().join(".languagecheck.yaml"),
        "engines:\n  harper: true\n  spell_language: \"en-US\"\n",
    )
    .expect("write config");
    let notes = dir.path().join("notes.md");
    let text = "# Notes\n\nThis sentense has a mistake.\n";
    std::fs::write(&notes, text).expect("write notes");
    let mut child = server();
    let answers = responses(&mut child);
    let deadline = Duration::from_secs(30);

    for round in 0..80 {
        let id = 1000 + round * 4;
        send_initialize(&mut child, id, dir.path(), &db);
        std::thread::sleep(Duration::from_micros(750 * round));
        send_initialize(&mut child, id + 1, dir.path(), &db);
        for (offset, path) in [(2, &notes), (3, &notes)] {
            let request = Request {
                id: id + offset,
                payload: Some(request::Payload::CheckProse(CheckRequest {
                    text: text.to_owned(),
                    language_id: "markdown".to_owned(),
                    file_path: Some(path.to_string_lossy().into_owned()),
                    ..Default::default()
                })),
            };
            send_frame(&mut child, &request.encode_to_vec());
        }
        for _ in 0..4 {
            let response = answers.recv_timeout(deadline).unwrap_or_else(|_| {
                child.kill().ok();
                panic!(
                    "round {round} (gap {} us): the core stopped answering",
                    750 * round
                )
            });
            assert!(
                !matches!(response.payload, Some(response::Payload::Error(_))),
                "{response:?}"
            );
        }
    }
    child.kill().ok();
}

#[test]
fn an_unreadable_index_is_replaced_and_said_so() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("index.redb");
    std::fs::write(&db, b"not a database".repeat(200)).expect("write");
    let mut child = server();
    let answer = initialize(&mut child, dir.path(), &db);
    assert_eq!(answer.warnings.len(), 1, "{:?}", answer.warnings);
    assert!(
        answer.warnings[0].contains("unreadable")
            || answer.warnings[0].contains("could not be read")
    );
    child.kill().ok();
}
