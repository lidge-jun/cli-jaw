export type JawCeoVoiceCue = 'start' | 'silent' | 'stop' | 'error';

const cueTones: Record<JawCeoVoiceCue, number[]> = {
    start: [523.25, 659.25],
    silent: [392.0],
    stop: [659.25, 392.0],
    error: [220.0, 196.0],
};

export function playJawCeoVoiceCue(cue: JawCeoVoiceCue): void {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
        const context = new AudioContextCtor();
        const now = context.currentTime;
        cueTones[cue].forEach((frequency, index) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const start = now + index * 0.085;
            oscillator.type = cue === 'silent' ? 'sine' : 'triangle';
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(cue === 'silent' ? 0.015 : 0.024, start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.105);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.12);
        });
        window.setTimeout(() => void context.close().catch(() => undefined), 420);
    } catch {
        // Audio cues are non-critical visual-state helpers.
    }
}
