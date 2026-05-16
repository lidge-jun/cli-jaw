use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::normalize;

pub fn tail_transcript(
    transcript_path: &Path,
    stop: Arc<AtomicBool>,
    output_format: &str,
) -> Result<Option<serde_json::Value>, String> {
    let mut file = wait_for_file(transcript_path, &stop, 20_000)?;
    let mut offset: u64 = 0;
    let mut last_assistant: Option<serde_json::Value> = None;

    loop {
        let reader = BufReader::new(&file);
        let mut any_line = false;

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let line_bytes = line.len() as u64 + 1; // +1 for newline

                    if line.trim().is_empty() {
                        offset += line_bytes;
                        any_line = true;
                        continue;
                    }

                    // Only advance offset if JSON parses — partial writes retry next poll
                    if serde_json::from_str::<serde_json::Value>(&line).is_err() {
                        log::debug!("transcript: incomplete JSON, will retry: {}...", &line[..line.len().min(80)]);
                        break;
                    }

                    any_line = true;
                    offset += line_bytes;

                    if let Some(normalized) = normalize::normalize_transcript_line(&line) {
                        emit_line(&normalized, output_format);

                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                            if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                                last_assistant = Some(v);
                            }
                        }
                    }
                }
                Err(e) => {
                    log::debug!("transcript read error: {e}");
                    break;
                }
            }
        }

        if stop.load(Ordering::Relaxed) {
            if any_line {
                // One more drain pass after stop signal
                std::thread::sleep(std::time::Duration::from_millis(300));
                if let Ok(mut f) = File::open(transcript_path) {
                    let _ = f.seek(SeekFrom::Start(offset));
                    let r = BufReader::new(f);
                    for line in r.lines().flatten() {
                        if let Some(normalized) = normalize::normalize_transcript_line(&line) {
                            emit_line(&normalized, output_format);
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                            if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                                last_assistant = Some(v);
                            }
                        }
                    }
                }
            }
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(100));
        // Seek to current offset for next read pass
        let _ = file.seek(SeekFrom::Start(offset));
    }

    Ok(last_assistant)
}

fn emit_line(normalized: &str, output_format: &str) {
    match output_format {
        "stream-json" => println!("{normalized}"),
        "json" => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(normalized) {
                let t = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if t == "assistant" || t == "result" {
                    println!("{normalized}");
                }
            }
        }
        "text" => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(normalized) {
                if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                    extract_and_print_text(&v);
                }
            }
        }
        _ => println!("{normalized}"),
    }
}

fn wait_for_file(path: &Path, stop: &AtomicBool, timeout_ms: u64) -> Result<File, String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);

    loop {
        if let Ok(f) = File::open(path) {
            return Ok(f);
        }
        if start.elapsed() > timeout {
            return Err(format!("transcript not found after {timeout_ms}ms: {}", path.display()));
        }
        if stop.load(Ordering::Relaxed) {
            return Err("stopped before transcript appeared".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

fn extract_and_print_text(value: &serde_json::Value) {
    if let Some(message) = value.get("message") {
        if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
            for block in content {
                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                        print!("{text}");
                    }
                }
            }
        }
    }
}
