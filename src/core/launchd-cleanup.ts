/**
 * Legacy cli-jaw LaunchAgent plist 판별 — 순수 함수.
 * 구 버전 `jaw_launchd.sh` 또는 legacy installer 산물을 탐지.
 *
 * 현재 포맷(`cli-jaw-<port>-<hash8>`)은 multi-instance 운영을 위해 보존한다.
 * 해시 없는 `cli-jaw-<port>`만 구버전으로 취급.
 */
export function findLegacyCliJawLabels(files: string[], currentLabel: string): string[] {
    return files
        .filter(f => f.startsWith('com.cli-jaw.') && f.endsWith('.plist'))
        .map(f => f.replace(/\.plist$/, ''))
        .filter(label => label !== currentLabel && (
            label === 'com.cli-jaw.local' ||
            /^com\.cli-jaw\.cli-jaw-\d+$/.test(label)
        ));
}
