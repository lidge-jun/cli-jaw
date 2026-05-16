use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::panic;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::terminal;

pub struct PtyChild {
    pub child: Box<dyn portable_pty::Child + Send>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub last_change_us: Arc<AtomicU64>,
    pub stop: Arc<AtomicBool>,
    drain_handle: Option<thread::JoinHandle<()>>,
}

impl PtyChild {
    pub fn spawn(
        claude_bin: &str,
        args: &[String],
        cwd: &std::path::Path,
        cols: u16,
        rows: u16,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY open failed: {e}"))?;

        let mut cmd = CommandBuilder::new(claude_bin);
        cmd.args(args);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Claude spawn failed: {e}"))?;

        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|e| format!("PTY writer failed: {e}"))?,
        ));

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("PTY reader failed: {e}"))?;

        let last_change_us = Arc::new(AtomicU64::new(now_us()));
        let drain_last_change = Arc::clone(&last_change_us);
        let drain_stop = Arc::clone(&stop);
        let drain_writer = Arc::clone(&writer);

        let panic_stop = Arc::clone(&stop);
        let drain_handle = thread::spawn(move || {
            let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
                let mut buf = [0u8; 8192];
                let mut parser = vt100::Parser::new(rows, cols, 0);
                let mut prev_hash: u64 = 0;
                let mut total_bytes: u64 = 0;

                while !drain_stop.load(Ordering::Relaxed) {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let chunk = &buf[..n];
                            total_bytes += n as u64;
                            parser.process(chunk);

                            let responses = terminal::answer_terminal_query(chunk, cols, rows);
                            if !responses.is_empty() {
                                if let Ok(mut w) = drain_writer.lock() {
                                    for resp in responses {
                                        let _ = w.write_all(&resp);
                                    }
                                    let _ = w.flush();
                                }
                            }

                            // Reset parser periodically to bound memory (every 10MB)
                            if total_bytes > 10_000_000 {
                                parser = vt100::Parser::new(rows, cols, 0);
                                total_bytes = 0;
                                prev_hash = 0;
                            }

                            let screen = parser.screen();
                            let content = screen.contents();
                            let hash = simple_hash(&content);
                            if hash != prev_hash {
                                prev_hash = hash;
                                drain_last_change.store(now_us(), Ordering::Relaxed);
                            }
                        }
                        Err(e) => {
                            log::debug!("PTY read error: {e}");
                            break;
                        }
                    }
                }
            }));
            if result.is_err() {
                log::error!("drain thread panicked — signaling stop");
                panic_stop.store(true, Ordering::Relaxed);
            }
        });

        Ok(Self {
            child,
            writer,
            last_change_us,
            stop,
            drain_handle: Some(drain_handle),
        })
    }

    pub fn wait_quiescence(&self, quiesce_ms: u64) {
        loop {
            let last = self.last_change_us.load(Ordering::Relaxed);
            let elapsed = now_us().saturating_sub(last);
            if elapsed >= quiesce_ms * 1000 {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(50));
            if self.stop.load(Ordering::Relaxed) {
                break;
            }
        }
    }

    pub fn join_drain(&mut self) {
        if let Some(handle) = self.drain_handle.take() {
            let _ = handle.join();
        }
    }
}

fn now_us() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 5381;
    for b in s.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(u64::from(b));
    }
    hash
}
