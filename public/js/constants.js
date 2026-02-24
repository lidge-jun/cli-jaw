// ── Constants ──
export const MODEL_MAP = {
    claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-sonnet-4-6[1m]', 'claude-opus-4-6[1m]', 'claude-haiku-4-5-20251001'],
    codex: ['gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'],
    gemini: ['gemini-3.0-pro-preview', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.5-flash'],
    opencode: [
        'github-copilot/claude-sonnet-4.5', 'github-copilot/claude-opus-4.6',
        'github-copilot/gpt-5', 'github-copilot/gemini-2.5-pro',
        'opencode/big-pickle', 'opencode/GLM-5 Free', 'opencode/MiniMax M2.5 Free',
        'opencode/Kimi K2.5 Free', 'opencode/GPT 5 Nano Free', 'opencode/Grok Code Fast 1 Free',
    ],
};

export const ROLE_PRESETS = [
    { value: 'frontend', label: '🎨 프런트엔드', prompt: 'UI/UX 구현, CSS, 컴포넌트 개발', skill: 'dev-frontend' },
    { value: 'backend', label: '⚙️ 백엔드', prompt: 'API, DB, 서버 로직 구현', skill: 'dev-backend' },
    { value: 'data', label: '📊 데이터', prompt: '데이터 파이프라인, 분석, ML', skill: 'dev-data' },
    { value: 'docs', label: '📝 문서작성', prompt: '문서화, README, API docs', skill: 'documentation' },
    { value: 'custom', label: '✏️ 커스텀...', prompt: '', skill: null },
];
