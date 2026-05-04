import type { ProcessStep } from './process-block.js';

export function findLegacyRunningMatch(steps: ProcessStep[], step: ProcessStep): ProcessStep | null {
    const matches = steps.filter(s => s.status === 'running'
        && !s.stepRef
        && s.label === step.label
        && s.type === step.type);
    return matches.length === 1 ? matches[0]! : null;
}

export function findRunningProcessStepMatch(steps: ProcessStep[], step: ProcessStep): ProcessStep | null {
    const running = [...steps].reverse().filter(s => s.status === 'running');
    if (step.stepRef) {
        return running.find(s => s.stepRef === step.stepRef)
            ?? findLegacyRunningMatch(running, step);
    }
    return findLegacyRunningMatch(running, step);
}
