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
    InitializeRequest, InitializeResponse, MetadataRequest, Request, Response, request, response,
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

/// Checks that overlap are each answered. Requests are handled concurrently,
/// and two checks once took the same two locks in opposite orders (the
/// fingerprint: dictionary, then ignores; the suppression pass: ignores,
/// then dictionary), so a pair that met in the middle deadlocked, and every
/// request after them waited behind it. Two browser tabs on one project,
/// or fast typing in VS Code, send exactly such checks.
#[test]
fn overlapping_checks_are_all_answered() {
    const CHECKS: u64 = 32;
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    for id in 0..CHECKS {
        let request = Request {
            id: 100 + id,
            payload: Some(request::Payload::CheckProse(
                lang_check::checker::CheckRequest {
                    text: format!("Teh {id} recieve it, seperately."),
                    language_id: "markdown".into(),
                    ..Default::default()
                },
            )),
        };
        send_frame(&mut child, &request.encode_to_vec());
    }
    // Read on a thread, so a hung server fails the test instead of hanging it.
    let mut stdout = child.stdout.take().expect("stdout");
    let (answers, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for _ in 0..CHECKS {
            let mut length = [0u8; 4];
            if stdout.read_exact(&mut length).is_err() {
                return;
            }
            let mut body = vec![0u8; u32::from_be_bytes(length) as usize];
            if stdout.read_exact(&mut body).is_err() {
                return;
            }
            let response = Response::decode(body.as_slice()).expect("a decodable response");
            if answers.send(response.id).is_err() {
                return;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut ids = Vec::new();
    while ids.len() < CHECKS as usize {
        let left = deadline.saturating_duration_since(Instant::now());
        match received.recv_timeout(left) {
            Ok(id) => ids.push(id),
            Err(_) => break,
        }
    }
    child.kill().ok();
    ids.sort_unstable();
    assert_eq!(
        ids,
        (100..100 + CHECKS).collect::<Vec<_>>(),
        "checks left unanswered"
    );
}

/// One request's answer, sent and read in turn.
fn ask(child: &mut Child, id: u64, payload: request::Payload) -> Response {
    send_frame(
        child,
        &Request {
            id,
            payload: Some(payload),
        }
        .encode_to_vec(),
    );
    let response = read_response(child);
    assert_eq!(response.id, id);
    response
}

/// The browser extension's config page reads and writes the workspace
/// config through the core: by file name, never a path, the first config
/// name present taken as it is, a new one created as .languagecheck.yaml.
#[test]
fn the_config_is_read_and_written_by_name() {
    use lang_check::checker::{ReadConfigRequest, WriteConfigRequest};
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let read = |child: &mut Child, id| match ask(
        child,
        id,
        request::Payload::ReadConfig(ReadConfigRequest {}),
    )
    .payload
    {
        Some(response::Payload::ReadConfig(answer)) => answer,
        other => panic!("ReadConfig answered {other:?}"),
    };
    let none = read(&mut child, 2);
    assert!(!none.exists);
    assert_eq!(
        (none.file_name.as_str(), none.text.as_str()),
        (".languagecheck.yaml", "")
    );

    let written = ask(
        &mut child,
        3,
        request::Payload::WriteConfig(WriteConfigRequest {
            text: "engines:\n  harper: false\n".into(),
        }),
    );
    assert!(matches!(written.payload, Some(response::Payload::Ok(_))));
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".languagecheck.yaml")).expect("written"),
        "engines:\n  harper: false\n"
    );
    let back = read(&mut child, 4);
    assert!(back.exists);
    assert_eq!(back.text, "engines:\n  harper: false\n");
    // No staging file is left behind.
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .expect("dir")
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with(".languagecheck"))
        .collect();
    assert_eq!(names, vec![".languagecheck.yaml".to_owned()]);

    let too_long = ask(
        &mut child,
        5,
        request::Payload::WriteConfig(WriteConfigRequest {
            text: "#".repeat(lang_check::config::Config::MAX_TEXT_BYTES + 1),
        }),
    );
    assert!(matches!(
        too_long.payload,
        Some(response::Payload::Error(_))
    ));
    child.kill().ok();

    // A .yml in force is the one read and written.
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join(".languagecheck.yml"), "engines: {}\n").expect("seed");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    assert_eq!(read(&mut child, 2).file_name, ".languagecheck.yml");
    ask(
        &mut child,
        3,
        request::Payload::WriteConfig(WriteConfigRequest {
            text: "names:\n  enabled: true\n".into(),
        }),
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".languagecheck.yml")).expect("yml"),
        "names:\n  enabled: true\n"
    );
    assert!(!dir.path().join(".languagecheck.yaml").exists());
    child.kill().ok();
}

/// The server's resident memory, from /proc (Linux only).
#[cfg(target_os = "linux")]
fn rss_kib(child: &Child) -> u64 {
    let status =
        std::fs::read_to_string(format!("/proc/{}/status", child.id())).expect("proc status");
    status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))
        .and_then(|value| value.trim().trim_end_matches("kB").trim().parse().ok())
        .expect("VmRSS")
}

/// Checks `count` texts in turn, each answered before the next is sent.
#[cfg(target_os = "linux")]
fn check_many(child: &mut Child, first_id: u64, count: u64) {
    for id in first_id..first_id + count {
        let request = Request {
            id,
            payload: Some(request::Payload::CheckProse(
                lang_check::checker::CheckRequest {
                    // A different text each time, so nothing is answered from a store.
                    text: format!(
                        "Paragraph {id}: teh weather was fine and we recieve {id} letters, seperately."
                    ),
                    language_id: "markdown".into(),
                    ..Default::default()
                },
            )),
        };
        send_frame(child, &request.encode_to_vec());
        assert_eq!(read_response(child).id, id);
    }
}

/// A server that checks all day holds what checking needs, not what every
/// check made. Its resident memory climbs for a long time while bounded
/// caches (the result cache, Harper's 10 000-entry LRUs) and the allocator
/// fill -- measured 2026-10-07, debug build, a different text per check:
/// 315 MiB after 5k checks, 406 MiB after 65k, then 408 MiB from 75k to
/// 100k. So the test runs past the plateau and allows 8 MiB over the last
/// 25 000 checks, where a leak of even 400 bytes a check exceeds it.
///
/// About seven minutes in a debug build, so not in the default run:
/// `cargo test --test server_protocol -- --ignored checking_for_long`.
#[cfg(target_os = "linux")]
#[test]
#[ignore = "long: about seven minutes; run on demand with --ignored"]
fn checking_for_long_does_not_grow_the_server() {
    const ALLOWANCE_KIB: u64 = 8 * 1024;
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    check_many(&mut child, 1_000_000, 75_000);
    let settled = rss_kib(&child);
    check_many(&mut child, 2_000_000, 25_000);
    let after = rss_kib(&child);
    child.kill().ok();
    eprintln!("server RSS: {settled} KiB after 75k checks, {after} KiB after 25k more");
    assert!(
        after <= settled + ALLOWANCE_KIB,
        "server grew from {settled} KiB to {after} KiB over the last 25k checks"
    );
}

/// One check, answered in turn; `window` and `file_path` as the editor sends them.
fn check(
    child: &mut Child,
    id: u64,
    text: &str,
    window: Option<(u32, u32)>,
    file_path: Option<&str>,
) -> lang_check::checker::CheckResponse {
    let request = Request {
        id,
        payload: Some(request::Payload::CheckProse(
            lang_check::checker::CheckRequest {
                text: text.into(),
                language_id: "markdown".into(),
                file_path: file_path.map(Into::into),
                window: window.map(|(start_byte, end_byte)| lang_check::checker::ByteWindow {
                    start_byte,
                    end_byte,
                }),
                ..Default::default()
            },
        )),
    };
    send_frame(child, &request.encode_to_vec());
    let response = read_response(child);
    assert_eq!(response.id, id);
    match response.payload {
        Some(response::Payload::CheckProse(answer)) => answer,
        other => panic!("CheckProse answered {other:?}"),
    }
}

/// What a finding is, for comparing answers: where, and which rule.
fn findings(answer: &lang_check::checker::CheckResponse) -> Vec<(u32, u32, String)> {
    let mut found: Vec<_> = answer
        .diagnostics
        .iter()
        .map(|d| (d.start_byte, d.end_byte, d.rule_id.clone()))
        .collect();
    found.sort();
    found
}

const PARAGRAPHS: &str = "Teh first paragraph is here.\n\nAnother one, and I recieve it.\n\nA third, written seperately.\n\nThe last is fine.\n";

/// A long document's first check, a window at a time: the windows of any
/// tiling add up to the whole check, each describes every range, and a
/// window that owns no range finds nothing.
#[test]
fn the_windows_of_a_tiling_add_up_to_the_whole_check() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let whole = check(&mut child, 10, PARAGRAPHS, None, None);
    assert_eq!(whole.window, None, "a whole check says it was one");
    let expected = findings(&whole);
    assert!(
        expected.len() >= 3,
        "the fixture has three misspellings: {expected:?}"
    );
    let length = u32::try_from(PARAGRAPHS.len()).expect("short");
    let mut id = 11;
    for width in [1, 7, 30, 31, 64, length] {
        let mut together = Vec::new();
        let mut start = 0;
        while start < length {
            let end = (start + width).min(length);
            let answer = check(&mut child, id, PARAGRAPHS, Some((start, end)), None);
            id += 1;
            // Echoed: the client tells a windowed answer from an older
            // core's whole one by it.
            assert_eq!(
                answer.window.map(|w| (w.start_byte, w.end_byte)),
                Some((start, end))
            );
            let ranges = answer
                .extraction
                .as_ref()
                .map_or(0, |e| e.prose_ranges.len());
            assert_eq!(
                ranges,
                whole
                    .extraction
                    .as_ref()
                    .map_or(0, |e| e.prose_ranges.len()),
                "a window describes every range"
            );
            together.extend(findings(&answer));
            start = end;
        }
        together.sort();
        assert_eq!(together, expected, "windows of {width} bytes");
    }
    // Past the text: owns nothing.
    assert_eq!(
        findings(&check(
            &mut child,
            id,
            PARAGRAPHS,
            Some((length, length + 100)),
            None
        )),
        Vec::new()
    );
    // Backwards: owns nothing either.
    assert_eq!(
        findings(&check(&mut child, id + 1, PARAGRAPHS, Some((20, 5)), None)),
        Vec::new()
    );
    child.kill().ok();
}

/// Window edges that fall inside a character (UTF-8 runs of two to four
/// bytes) change nothing: ranges start on characters, and are owned by
/// their start.
#[test]
fn windows_cutting_through_characters_still_add_up() {
    const TEXT: &str = "Teh café ☕ opens at nine.\n\nI recieve 😀 the naïve résumé.\n\n日本語の文。 Then seperately, teh end.\n";
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let expected = findings(&check(&mut child, 10, TEXT, None, None));
    assert!(expected.len() >= 3, "{expected:?}");
    let length = u32::try_from(TEXT.len()).expect("short");
    let mut id = 11;
    for width in [1, 2, 3, 5, 13] {
        let mut together = Vec::new();
        let mut start = 0;
        while start < length {
            let end = (start + width).min(length);
            together.extend(findings(&check(
                &mut child,
                id,
                TEXT,
                Some((start, end)),
                None,
            )));
            id += 1;
            start = end;
        }
        together.sort();
        assert_eq!(together, expected, "windows of {width} bytes");
    }
    child.kill().ok();
}

/// A window's answer is not the file's: it is not stored as the file's
/// result, so the whole check after it runs and finds everything.
#[test]
fn a_windowed_check_is_not_stored_as_the_files_result() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let file = dir.path().join("doc.md");
    let file = file.to_str().expect("utf-8 path");
    let first = check(&mut child, 10, PARAGRAPHS, Some((0, 10)), Some(file));
    assert_eq!(
        findings(&first).len(),
        1,
        "only the first paragraph's: {:?}",
        findings(&first)
    );
    let whole = check(&mut child, 11, PARAGRAPHS, None, Some(file));
    assert!(!whole.served_from_cache);
    assert!(findings(&whole).len() >= 3);
    // And the whole answer, stored now, is not served for a window either.
    let again = check(&mut child, 12, PARAGRAPHS, Some((0, 10)), Some(file));
    assert!(!again.served_from_cache);
    assert_eq!(findings(&again), findings(&first));
    child.kill().ok();
}

/// What a host page's own spellchecker marked, as the web client sends it.
fn foreign(text: &str, word: &str) -> lang_check::checker::ForeignFinding {
    let start = text.find(word).expect("the word is in the text");
    lang_check::checker::ForeignFinding {
        checker: "typst".into(),
        rule: "misspelling".into(),
        category: lang_check::checker::ForeignCategory::Spelling as i32,
        start_byte: u32::try_from(start).expect("small"),
        end_byte: u32::try_from(start + word.len()).expect("small"),
        message: format!("the word \"{word}\" seems to be misspelled"),
        language: "en".into(),
    }
}

/// A check carrying foreign findings; `window` and `file_path` as in [`check`].
fn check_foreign(
    child: &mut Child,
    id: u64,
    text: &str,
    window: Option<(u32, u32)>,
    file_path: Option<&str>,
    foreign: Vec<lang_check::checker::ForeignFinding>,
) -> lang_check::checker::CheckResponse {
    let request = request::Payload::CheckProse(lang_check::checker::CheckRequest {
        text: text.into(),
        language_id: "markdown".into(),
        file_path: file_path.map(Into::into),
        window: window.map(|(start_byte, end_byte)| lang_check::checker::ByteWindow {
            start_byte,
            end_byte,
        }),
        foreign,
        ..Default::default()
    });
    match ask(child, id, request).payload {
        Some(response::Payload::CheckProse(answer)) => answer,
        other => panic!("CheckProse answered {other:?}"),
    }
}

/// The diagnostics over `word`'s first occurrence, by rule id.
fn rules_at(answer: &lang_check::checker::CheckResponse, text: &str, word: &str) -> Vec<String> {
    let start = u32::try_from(text.find(word).expect("the word is in the text")).expect("small");
    let mut rules: Vec<String> = answer
        .diagnostics
        .iter()
        .filter(|d| d.start_byte == start)
        .map(|d| d.rule_id.clone())
        .collect();
    rules.sort();
    rules
}

const FOREIGN_TEXT: &str =
    "I recieve teh parcel with `wrod` inside.\n\nA second paragraph about parcels.\n";

/// A host's spellchecker marking the word an engine marks too is one
/// diagnostic, the engine's; one it alone marks is drawn as its own; one in
/// code our extraction skips is dropped.
#[test]
fn foreign_findings_merge_with_the_engines_and_stand_where_they_alone_found_something() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let text = FOREIGN_TEXT;
    let answer = check_foreign(
        &mut child,
        10,
        text,
        None,
        None,
        vec![
            foreign(text, "teh"),
            foreign(text, "parcel"),
            foreign(text, "wrod"),
        ],
    );
    let teh = rules_at(&answer, text, "teh");
    assert_eq!(teh.len(), 1, "one diagnostic on teh: {teh:?}");
    assert!(teh[0].starts_with("harper"), "the engine's kept: {teh:?}");
    assert_eq!(rules_at(&answer, text, "parcel"), ["typst.misspelling"]);
    assert!(rules_at(&answer, text, "wrod").is_empty(), "inside code");

    // Without them, the same text answers as before.
    let plain = check(&mut child, 11, text, None, None);
    assert!(rules_at(&plain, text, "parcel").is_empty());
    child.kill().ok();
}

/// The dictionary applies to what a host found, as to what an engine found.
#[test]
fn a_dictionary_word_is_not_shown_from_a_foreign_checker_either() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let text = FOREIGN_TEXT;
    let add = request::Payload::AddDictionaryWord(lang_check::checker::AddDictionaryWordRequest {
        word: "parcel".into(),
    });
    ask(&mut child, 10, add);
    let answer = check_foreign(
        &mut child,
        11,
        text,
        None,
        None,
        vec![foreign(text, "parcel")],
    );
    assert!(
        rules_at(&answer, text, "parcel").is_empty(),
        "{:?}",
        findings(&answer)
    );
    child.kill().ok();
}

/// Foreign findings are not the engines' answer: the stored result does not
/// hold them, and a window takes only those in the ranges it owns.
#[test]
fn foreign_findings_are_never_stored_and_follow_the_window() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = server();
    initialize(&mut child, dir.path(), &dir.path().join("index.db"));
    let file = dir.path().join("doc.md");
    let file = file.to_str().expect("utf-8 path");
    let text = FOREIGN_TEXT;
    let second = text.find("parcels").expect("second paragraph");
    let in_second = {
        let mut finding = foreign(text, "parcels");
        finding.start_byte = u32::try_from(second).expect("small");
        finding
    };

    let first = check_foreign(
        &mut child,
        10,
        text,
        None,
        Some(file),
        vec![foreign(text, "parcel"), in_second.clone()],
    );
    assert!(!first.served_from_cache);
    assert_eq!(rules_at(&first, text, "parcel"), ["typst.misspelling"]);
    let again = check(&mut child, 11, text, None, Some(file));
    assert!(again.served_from_cache, "the engines' answer was stored");
    assert!(
        again
            .diagnostics
            .iter()
            .all(|d| !d.rule_id.starts_with("typst.")),
        "and it holds none of the host's: {:?}",
        findings(&again)
    );

    // A window over the first paragraph only: the second one's is not its to show.
    let paragraph = text.find("A second").expect("second paragraph");
    let window = (0, u32::try_from(paragraph).expect("small"));
    let windowed = check_foreign(
        &mut child,
        12,
        text,
        Some(window),
        Some(file),
        vec![foreign(text, "parcel"), in_second],
    );
    assert_eq!(rules_at(&windowed, text, "parcel"), ["typst.misspelling"]);
    assert!(
        windowed
            .diagnostics
            .iter()
            .all(|d| d.start_byte as usize != second)
    );
    child.kill().ok();
}
