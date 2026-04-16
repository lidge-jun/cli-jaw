#!/bin/bash
# prime-tcc.sh — TCC AppleEvents 권한 프롬프트 명시 트리거 (macOS)
# 사용: jaw doctor --tcc --prime 또는 수동 1회 실행

set -e

CUA_APP="/Applications/Codex Computer Use.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "❌ macOS 전용 스크립트"
    exit 1
fi

if [[ ! -d "$CUA_APP" ]]; then
    echo "❌ CUA 앱 없음 — jaw doctor --tcc --fix 또는 npm rebuild -g cli-jaw"
    exit 1
fi

# 1. CUA 앱을 1회 실행해 Launch Services 등록 확정
open -g "$CUA_APP"
sleep 1
osascript -e 'tell application "Codex Computer Use" to quit' 2>/dev/null || true

# 2. Chrome 제어 테스트 — 최초 실행 시 권한 프롬프트
echo "🔐 Chrome 제어 권한 프롬프트가 뜨면 '허용'을 클릭하세요..."
if ! osascript -e 'tell application "Google Chrome" to get name of front window' 2>/dev/null; then
    echo ""
    echo "❌ 권한 거부 또는 프롬프트 없음"
    echo "   시스템 설정 → 개인정보 보호 및 보안 → 자동화"
    echo "   → Terminal 또는 Codex Computer Use에서 Google Chrome 허용"
    exit 1
fi

# 3. System Events 테스트
osascript -e 'tell application "System Events" to get name of first process' >/dev/null 2>&1 || true

echo "✅ TCC 권한 준비 완료"
