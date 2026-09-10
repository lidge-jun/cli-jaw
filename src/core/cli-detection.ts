import { CLI_KEYS, CLI_REGISTRY } from '../cli/registry.js';
import { detectCliBinary, type CliDetection } from './cli-detect.js';

export function detectCli(name: string): CliDetection {
    const binary = (CLI_REGISTRY as Record<string, any>)[name]?.binary || name;
    if (name === 'kiro-code') return detectKiroCode();
    if (name === 'pi') return detectPi();
    return detectCliBinary(binary);
}

function detectPi(): CliDetection {
    const explicit = process.env["PI_CODING_AGENT_BIN"];
    if (explicit) {
        const explicitDetected = detectCliBinary(explicit);
        if (explicitDetected.available) return explicitDetected;
    }
    const pathDetected = detectCliBinary('pi');
    if (pathDetected.available) return pathDetected;
    const npmDetected = detectCliBinary('npm');
    if (npmDetected.available) {
        return mergeRejectedDetections({
            available: true,
            path: npmDetected.path,
            rejected: [{ path: 'pi', reason: 'using npm-exec @earendil-works/pi-coding-agent fallback' }],
        }, pathDetected);
    }
    return mergeRejectedDetections({ available: false, path: null }, pathDetected, npmDetected);
}

function detectKiroCode(): CliDetection {
    const explicit = process.env["KIRO_CODE_BIN"];
    if (explicit) {
        const explicitDetected = detectCliBinary(explicit);
        if (explicitDetected.available) return explicitDetected;
    }
    const aliasDetected = detectCliBinary('kiro-code');
    if (aliasDetected.available) return aliasDetected;
    return detectCliBinary('kiro-cli');
}

export function detectAllCli(): Record<string, CliDetection> {
    const out: Record<string, CliDetection> = {};
    for (const key of CLI_KEYS) out[key] = detectCli(key);
    return out;
}

function mergeRejectedDetections(result: CliDetection, ...sources: Array<CliDetection | null>): CliDetection {
    const rejected = sources
        .flatMap((source) => source?.rejected || [])
        .filter((entry) => entry.reason !== 'ENOENT');
    return {
        ...result,
        ...(rejected.length || result.rejected?.length
            ? { rejected: [...(result.rejected || []), ...rejected] }
            : {}),
    };
}
