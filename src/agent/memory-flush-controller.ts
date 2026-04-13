// ─── Memory Flush Controller ─────────────────────────
// Extracted from spawn.ts to reduce file size.

import fs from 'fs';
import { join } from 'path';
import { settings } from '../core/config.js';
import { getRecentMessages } from '../core/db.js';
import { getMemoryFlushFilePath } from '../memory/runtime.js';

export let memoryFlushCounter = 0;
export let flushCycleCount = 0;

export function incrementMemoryFlush(): void {
    memoryFlushCounter++;
}

export function resetMemoryFlushCounter(): void {
    memoryFlushCounter = 0;
    flushCycleCount++;
}

// Forward reference to spawnAgent (avoid circular import)
let _spawnAgent: Function;
let _activeProcesses: Map<string, any>;

export function setSpawnRef(fn: Function, procs: Map<string, any>): void {
    _spawnAgent = fn;
    _activeProcesses = procs;
}

export async function triggerMemoryFlush(): Promise<void> {
    const { getMemoryDir } = await import('../prompt/builder.js');
    const threshold = settings.memory?.flushEvery ?? 10;
    const recent = (getRecentMessages.all(settings.workingDir || null, threshold) as any[]).reverse();
    if (recent.length < 4) return;

    const lines = [];
    for (const m of recent) {
        lines.push(`[${m.role}] ${m.content}`);
    }
    const convo = lines.join('\n\n');
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toTimeString().slice(0, 5);
    const memDir = getMemoryDir();
    const memFile = getMemoryFlushFilePath(date);

    const flushPrompt = `You are a memory extractor. Summarize the conversation into a short prose paragraph.
Save by APPENDING to: ${memFile}
Create directories if needed.

Rules:
- Write 1-3 SHORT English sentences capturing decisions, facts, preferences only
- Skip greetings, errors, small talk
- If nothing worth remembering, reply "SKIP" and do NOT write any file
- Format:

## ${time}

[your 1-3 sentence summary here]

Conversation:
---
${convo}`;

    fs.mkdirSync(join(memFile, '..'), { recursive: true });

    const flushCli = settings.memory?.cli || settings.cli;
    const flushModel = settings.memory?.model || (settings.perCli?.[flushCli]?.model) || 'default';

    if (_activeProcesses?.has('memory-flush')) {
        console.log('[memory] flush already running, skipping');
        return;
    }
    _spawnAgent(flushPrompt, {
        agentId: 'memory-flush',
        internal: true,
        _skipInsert: true,
        cli: flushCli,
        model: flushModel,
        sysPrompt: '',
    });
    console.log(`[memory] auto-append triggered (${recent.length} msgs → ${flushCli}/${flushModel})`);
}
