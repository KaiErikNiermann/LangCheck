//! The server's framing, spoken to the real binary over its stdio.
//!
//! What the editor relies on when something arrives that is not a proper
//! request: an undecodable one is answered under its own id, so the editor
//! fails that request at once, and a length no request could have ends the
//! process, so the editor starts a fresh one instead of waiting on a stream
//! that is out of step.

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use lang_check::checker::{MetadataRequest, Request, Response, request, response};
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
