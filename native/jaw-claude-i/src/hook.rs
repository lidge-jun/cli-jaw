use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

pub struct HookDir {
    _temp_dir: TempDir,
    pub dir_path: PathBuf,
    pub relay_script: PathBuf,
}

impl HookDir {
    pub fn create() -> Result<Self, String> {
        let temp_dir = TempDir::with_prefix("jaw-claude-i-")
            .map_err(|e| format!("TempDir creation failed: {e}"))?;

        let dir_path = temp_dir.path().to_path_buf();

        // Create the relay script that writes hook payload atomically
        let relay_script = dir_path.join("hook-relay.sh");
        let script_content = format!(
            r#"#!/bin/sh
# jaw-claude-i hook relay — writes payload atomically, no stdout
EVENT="$1"
DIR="{dir}"
PAYLOAD="$(cat)"
printf '%s' "$PAYLOAD" > "$DIR/hook-$EVENT.payload.$$.tmp"
mv "$DIR/hook-$EVENT.payload.$$.tmp" "$DIR/hook-$EVENT.payload"
touch "$DIR/hook-$EVENT.done"
"#,
            dir = dir_path.display()
        );

        fs::write(&relay_script, script_content)
            .map_err(|e| format!("relay script write failed: {e}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&relay_script, fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("relay chmod failed: {e}"))?;
        }

        Ok(Self {
            _temp_dir: temp_dir,
            dir_path,
            relay_script,
        })
    }

    pub fn build_settings_json(&self) -> String {
        let relay = self.relay_script.display();
        format!(
            r#"{{"hooks":{{"SessionStart":[{{"hooks":[{{"type":"command","command":"{relay} session-start"}}]}}],"Stop":[{{"hooks":[{{"type":"command","command":"{relay} stop"}}]}}],"StopFailure":[{{"hooks":[{{"type":"command","command":"{relay} stop-failure"}}]}}]}}}}"#
        )
    }

    pub fn sentinel_path(&self, event: &str) -> PathBuf {
        self.dir_path.join(format!("hook-{event}.done"))
    }

    pub fn payload_path(&self, event: &str) -> PathBuf {
        self.dir_path.join(format!("hook-{event}.payload"))
    }

    #[allow(dead_code)]
    pub fn wait_for_sentinel(&self, event: &str, timeout_ms: u64) -> Result<(), String> {
        let sentinel = self.sentinel_path(event);
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(timeout_ms);

        loop {
            if sentinel.exists() {
                return Ok(());
            }
            if start.elapsed() > timeout {
                return Err(format!(
                    "timeout waiting for {event} sentinel after {timeout_ms}ms"
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    pub fn read_payload(&self, event: &str) -> Option<serde_json::Value> {
        let path = self.payload_path(event);
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }
}

pub fn extract_transcript_path(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("transcript_path")
        .or_else(|| payload.get("transcriptPath"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

pub fn extract_session_id(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("session_id")
        .or_else(|| payload.get("sessionId"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_dir_creates_relay() {
        let hd = HookDir::create().expect("should create");
        assert!(hd.relay_script.exists());
        let content = fs::read_to_string(&hd.relay_script).expect("read");
        assert!(content.contains("jaw-claude-i"));
    }

    #[test]
    fn settings_json_valid() {
        let hd = HookDir::create().expect("should create");
        let json_str = hd.build_settings_json();
        let parsed: serde_json::Value = serde_json::from_str(&json_str).expect("valid json");
        assert!(parsed["hooks"]["SessionStart"].is_array());
        assert!(parsed["hooks"]["Stop"].is_array());
        assert!(parsed["hooks"]["StopFailure"].is_array());
    }

    #[test]
    fn extract_transcript_from_payload() {
        let payload = serde_json::json!({
            "session_id": "abc-123",
            "transcript_path": "/home/user/.claude/projects/x/abc.jsonl"
        });
        assert_eq!(
            extract_transcript_path(&payload),
            Some("/home/user/.claude/projects/x/abc.jsonl".to_string())
        );
        assert_eq!(extract_session_id(&payload), Some("abc-123".to_string()));
    }
}
