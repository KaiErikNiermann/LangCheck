//! Running a command-line checker: text in on stdin, a report out on stdout.
//!
//! Shared by Vale, proselint and external providers. Each of them is a
//! program the user configured, which may hang, flood stdout, or stop
//! reading stdin; none of that may stall the orchestrator, which holds its
//! lock across the call.

use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

/// How long one check may run before the process is killed.
pub const TIMEOUT: Duration = Duration::from_secs(30);
/// The most stdout a checker may produce for one text.
pub const MAX_STDOUT: usize = 16 * 1024 * 1024;
/// How much stderr is kept for the log; the rest is drained and dropped.
const MAX_STDERR: usize = 64 * 1024;

/// What a finished checker process left behind.
pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

/// Run `cmd` with `input` on stdin, bounded by [`TIMEOUT`] and [`MAX_STDOUT`].
///
/// stdin is written while stdout and stderr are read, not before: a checker
/// that answers before it has read everything would otherwise fill its
/// stdout pipe and wait on us while we wait on its stdin. The process is
/// killed when the call times out or fails.
pub async fn run(cmd: &mut Command, input: &[u8]) -> Result<ProcessOutput> {
    run_bounded(cmd, input, TIMEOUT, MAX_STDOUT).await
}

async fn run_bounded(
    cmd: &mut Command,
    input: &[u8],
    timeout: Duration,
    max_stdout: usize,
) -> Result<ProcessOutput> {
    let program = cmd.as_std().get_program().to_string_lossy().into_owned();
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("could not start {program}"))?;
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        bail!("{program} started without its pipes");
    };

    let write = async move {
        // A checker may exit, or stop reading, before taking all of its
        // input; what it says about that is in its exit status.
        let _ = stdin.write_all(input).await;
        drop(stdin);
        Ok(())
    };
    let exchange = async {
        let ((), stdout, stderr) = tokio::try_join!(
            write,
            read_stdout(stdout, max_stdout, &program),
            read_stderr(stderr),
        )?;
        let status = child.wait().await?;
        anyhow::Ok(ProcessOutput {
            status,
            stdout,
            stderr,
        })
    };
    match tokio::time::timeout(timeout, exchange).await {
        Ok(output) => output,
        Err(_) => bail!("{program} did not finish within {}s", timeout.as_secs()),
    }
}

async fn read_stdout(pipe: impl AsyncRead + Unpin, max: usize, program: &str) -> Result<String> {
    let mut buf = Vec::new();
    pipe.take(max as u64 + 1).read_to_end(&mut buf).await?;
    if buf.len() > max {
        bail!("{program} wrote more than {max} bytes of output");
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

async fn read_stderr(mut pipe: impl AsyncRead + Unpin) -> Result<String> {
    let mut buf = Vec::new();
    (&mut pipe)
        .take(MAX_STDERR as u64)
        .read_to_end(&mut buf)
        .await?;
    // Keep reading past the cap, or a chatty checker blocks on a full pipe.
    tokio::io::copy(&mut pipe, &mut tokio::io::sink()).await?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn sh(script: &str) -> Command {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(script);
        cmd
    }

    #[tokio::test]
    async fn echoes_stdin_and_reports_the_status() {
        let out = run(&mut sh("cat; exit 3"), b"hello").await.unwrap();
        assert_eq!(out.stdout, "hello");
        assert_eq!(out.status.code(), Some(3));
    }

    #[tokio::test]
    async fn a_hung_checker_times_out() {
        let err = run_bounded(&mut sh("sleep 30"), b"", Duration::from_millis(200), 1024)
            .await
            .err()
            .unwrap();
        assert!(err.to_string().contains("did not finish"), "{err}");
    }

    #[tokio::test]
    async fn unbounded_output_is_refused() {
        let err = run_bounded(&mut sh("yes"), b"", Duration::from_secs(10), 1024)
            .await
            .err()
            .unwrap();
        assert!(err.to_string().contains("more than 1024 bytes"), "{err}");
    }

    #[tokio::test]
    async fn a_checker_that_answers_before_reading_its_input_does_not_deadlock() {
        // 1 MiB each way: far beyond a pipe buffer in both directions.
        let input = vec![b'x'; 1024 * 1024];
        let out = run_bounded(
            &mut sh("head -c 1048576 /dev/zero; cat >/dev/null"),
            &input,
            Duration::from_secs(10),
            2 * 1024 * 1024,
        )
        .await
        .unwrap();
        assert_eq!(out.stdout.len(), 1024 * 1024);
    }

    #[tokio::test]
    async fn a_missing_program_is_an_error() {
        let err = run(&mut Command::new("lang-check-no-such-checker"), b"")
            .await
            .err()
            .unwrap();
        assert!(err.to_string().contains("could not start"), "{err}");
    }
}
