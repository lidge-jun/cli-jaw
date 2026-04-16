/**
 * Legacy cli-jaw LaunchAgent plist 판별 — 순수 함수.
 * 구 버전 `jaw_launchd.sh` 또는 legacy installer 산물을 탐지.
 */
export function findLegacyCliJawLabels(files: string[], currentLabel: string): string[] {
    return files
        .filter(f => f.startsWith('com.cli-jaw.') && f.endsWith('.plist'))
        .map(f => f.replace(/\.plist$/, ''))
        .filter(label => label !== currentLabel && (
            label === 'com.cli-jaw.local' ||
            /^com\.cli-jaw\.cli-jaw-\d+(-[a-f0-9]+)?$/.test(label)
        ));
}
