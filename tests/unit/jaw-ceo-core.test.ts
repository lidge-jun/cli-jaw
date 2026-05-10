import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completionFromInstanceMessage, canCreateFallbackCompletion } from '../../src/jaw-ceo/completion.ts';
import { createConfirmationRecord, hashConfirmationArgs, validateConfirmationRecord } from '../../src/jaw-ceo/confirmations.ts';
import { JawCeoCoordinator } from '../../src/jaw-ceo/coordinator.ts';
import { applyJawCeoDocsEdit, buildJawCeoDocsEditPolicy } from '../../src/jaw-ceo/docs-edit.ts';
import { canAutoVoiceResume, isReadonlyCliQueryAllowed } from '../../src/jaw-ceo/policy.ts';
import { buildJawCeoRealtimeResponseCreateEvent, buildJawCeoRealtimeSessionConfig, buildJawCeoRealtimeToolSchemas } from '../../src/jaw-ceo/realtime-sideband.ts';
import { createJawCeoStore } from '../../src/jaw-ceo/store.ts';
import type { JawCeoWatch } from '../../src/jaw-ceo/types.ts';

function fixedNow(): Date {
    return new Date('2026-05-10T00:00:00.000Z');
}

function sampleWatch(overrides: Partial<JawCeoWatch> = {}): JawCeoWatch {
    return {
        watchId: 'watch_1',
        dispatchRef: 'dispatch_1',
        port: 3457,
        reason: 'ceo_routed_task',
        latestMessageFallback: { mode: 'enabled', sinceMessageId: 10 },
        sessionId: 'ceo_1',
        autoRead: true,
        createdAt: fixedNow().toISOString(),
        lastUserActivityAt: fixedNow().toISOString(),
        ...overrides,
    };
}

test('jaw-ceo-store keeps pending completions bounded and auditable', () => {
    const store = createJawCeoStore({ maxPending: 1, now: fixedNow });
    const watch = sampleWatch();
    store.addWatch(watch);
    store.upsertCompletion(completionFromInstanceMessage({ port: 3457, messageId: 11, at: fixedNow().toISOString(), watch }));
    store.upsertCompletion(completionFromInstanceMessage({ port: 3457, messageId: 12, at: fixedNow().toISOString(), watch }));
    const pending = store.listPending();

    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.messageId, 12);

    const audit = store.appendAudit({
        kind: 'completion',
        action: 'completion.latest_message_fallback',
        ok: true,
        message: 'created',
    });
    assert.match(audit.id, /^audit_/);
    assert.equal(store.listAudit(1)[0]?.message, 'created');
});

test('jaw-ceo-store keeps a bounded server transcript for reconnecting consoles', () => {
    const store = createJawCeoStore({ maxTranscript: 2, now: fixedNow });
    store.appendTranscript({ role: 'user', text: 'first', source: 'text' });
    store.appendTranscript({ role: 'ceo', text: 'second', source: 'system' });
    store.appendTranscript({ role: 'tool', text: 'third', source: 'completion' });

    const transcript = store.getState().transcript;
    assert.equal(transcript.length, 2);
    assert.equal(transcript[0]?.text, 'second');
    assert.equal(transcript[1]?.text, 'third');
    assert.match(transcript[1]?.id || '', /^msg_/);
});

test('jaw-ceo-store can hydrate and persist transcript entries across process restarts', () => {
    const saved: string[] = [];
    const store = createJawCeoStore({
        maxTranscript: 3,
        now: fixedNow,
        initialTranscript: [
            { id: 'old_1', at: '2026-05-09T23:58:00.000Z', role: 'user', text: 'before restart', source: 'text' },
            { id: 'old_2', at: '2026-05-09T23:59:00.000Z', role: 'ceo', text: 'loaded after restart', source: 'system' },
        ],
        onTranscriptAppend: entry => saved.push(entry.text),
    });

    assert.deepEqual(store.getState().transcript.map(entry => entry.text), ['before restart', 'loaded after restart']);
    store.appendTranscript({ role: 'user', text: 'after reconnect', source: 'text' });

    assert.deepEqual(saved, ['after reconnect']);
    assert.deepEqual(store.getState().transcript.map(entry => entry.text), ['before restart', 'loaded after restart', 'after reconnect']);
});

test('jaw-ceo completion stores worker final text separately from preview summary', () => {
    const watch = sampleWatch();
    const finalText = [
        '## Patched dispatch',
        '',
        'The root cause was the dispatch CLI error handling and response shape bug.',
        'Continue/Speak must read this real final worker response.',
    ].join('\n');
    const completion = completionFromInstanceMessage({
        port: 3457,
        messageId: 11,
        at: fixedNow().toISOString(),
        watch,
        text: finalText,
    });

    assert.equal(completion.resultText, finalText);
    assert.match(completion.summary || '', /Patched dispatch/);
    assert.equal((completion.summary || '').length <= finalText.length, true);
});

test('jaw-ceo-completion fallback rejects stale or unsafe latest messages', () => {
    const enabledWatch = sampleWatch({ latestMessageFallback: { mode: 'enabled', sinceMessageId: 10 } });
    assert.deepEqual(canCreateFallbackCompletion({ watch: enabledWatch, messageId: 10 }), {
        ok: false,
        code: 'fallback_stale_message',
        message: 'latest assistant message is not newer than the watch baseline',
    });
    assert.deepEqual(canCreateFallbackCompletion({ watch: enabledWatch, messageId: 11 }), { ok: true });

    const disabledWatch = sampleWatch({ latestMessageFallback: { mode: 'disabled' } });
    assert.equal(canCreateFallbackCompletion({ watch: disabledWatch, messageId: 99 }).ok, false);

    const proofWatch = sampleWatch({ latestMessageFallback: { mode: 'requires_post_watch_proof' } });
    assert.equal(canCreateFallbackCompletion({ watch: proofWatch, messageId: 99 }).ok, false);
    assert.deepEqual(canCreateFallbackCompletion({ watch: proofWatch, messageId: 99, postWatchFingerprint: 'after-watch' }), { ok: true });
});

test('jaw-ceo-policy gates auto voice and read-only query commands', () => {
    assert.equal(canAutoVoiceResume({
        lastUserActivityAt: '2026-05-10T00:00:00.000Z',
        documentVisible: true,
        autoRead: true,
        now: new Date('2026-05-10T00:04:59.000Z'),
    }), true);
    assert.equal(canAutoVoiceResume({
        lastUserActivityAt: '2026-05-10T00:00:00.000Z',
        documentVisible: false,
        autoRead: true,
        now: new Date('2026-05-10T00:01:00.000Z'),
    }), false);
    assert.equal(isReadonlyCliQueryAllowed('git status --short'), true);
    assert.equal(isReadonlyCliQueryAllowed('git push origin main'), false);
    assert.equal(isReadonlyCliQueryAllowed('rg Jaw src'), true);
    assert.equal(isReadonlyCliQueryAllowed('rg Jaw src && rm file'), false);
});

test('jaw-ceo-coordinator sends worker messages with baseline watch and server-owned completion', async () => {
    const sentPrompts: string[] = [];
    const finalText = '## Patched dispatch\n\nThis is the real final worker response.';
    let latestId = 40;
    const coordinator = new JawCeoCoordinator({
        repoRoot: process.cwd(),
        now: fixedNow,
        store: createJawCeoStore({ now: fixedNow }),
        fetchLatestMessage: async () => ({
            latestAssistant: {
                id: latestId,
                role: 'assistant',
                created_at: fixedNow().toISOString(),
                ...(latestId > 40 ? { text: finalText } : {}),
            },
            activity: null,
        }),
        sendWorkerMessage: async ({ prompt }) => {
            sentPrompts.push(prompt);
            latestId = 41;
            return { ok: true, message: 'sent', data: { action: 'queued' } };
        },
    });

    const result = await coordinator.sendMessage({
        port: 3457,
        message: 'summarize current work',
        dispatchRef: 'dispatch_test',
        sourceChannel: 'ceo_text',
        responseMode: 'text',
        watchCompletion: true,
    });

    assert.equal(result.ok, true);
    assert.equal(sentPrompts[0], '[from: Jaw CEO]\nsummarize current work');
    assert.equal(coordinator.store.listWatches()[0]?.latestMessageFallback.sinceMessageId, 40);

    const stale = coordinator.ingestManagerEvent({ kind: 'instance-message', port: 3457, messageId: 40, role: 'assistant', at: fixedNow().toISOString() });
    assert.equal(stale.ok, false);
    const fresh = coordinator.ingestManagerEvent({ kind: 'instance-message', port: 3457, messageId: 41, role: 'assistant', at: fixedNow().toISOString(), text: finalText });
    assert.equal(fresh.ok, true);
    assert.equal(coordinator.store.listPending().length, 1);
    assert.equal(coordinator.store.listPending()[0]?.resultText, finalText);
    const completionKey = coordinator.store.listPending()[0]?.completionKey || '';

    const listed = await coordinator.executeRealtimeTool('ceo.get_pending_completions', { limit: 1 });
    assert.equal((listed.data as Array<{ resultText?: string }> | undefined)?.[0]?.resultText, finalText);

    const realtimeContinued = await coordinator.executeRealtimeTool('ceo.continue_completion', {
        completionKey,
        mode: 'voice',
    });
    assert.equal((realtimeContinued.data as { response?: string } | undefined)?.response, finalText);
    assert.equal(realtimeContinued.untrustedText, finalText);
    assert.equal(coordinator.store.listPending()[0]?.status, 'spoken');

    const continued = coordinator.continueCompletion(completionKey, 'text');
    assert.equal((continued.data as { response?: string } | undefined)?.response, finalText);
    assert.equal(continued.untrustedText, finalText);

    const silent = coordinator.continueCompletion(completionKey, 'silent');
    assert.equal((silent.data as { response?: string } | undefined)?.response, undefined);
    assert.equal(silent.untrustedText, undefined);
    assert.equal(JSON.stringify(silent).includes(finalText), false);

    const both = coordinator.continueCompletion(completionKey, 'both');
    assert.equal(coordinator.store.getCompletion(completionKey)?.status, 'spoken');
    assert.match(String((both.data as { response?: string } | undefined)?.response || ''), /real final worker response/);
});

test('jaw-ceo-coordinator persists user and CEO messages into public state', async () => {
    const coordinator = new JawCeoCoordinator({
        repoRoot: process.cwd(),
        now: fixedNow,
        store: createJawCeoStore({ now: fixedNow }),
    });

    const result = await coordinator.message({
        text: 'what is happening?',
        selectedPort: null,
        inputMode: 'text',
        responseMode: 'text',
    });

    assert.equal(result.ok, true);
    const transcript = coordinator.state().transcript;
    assert.equal(transcript.length, 2);
    assert.equal(transcript[0]?.role, 'user');
    assert.equal(transcript[0]?.text, 'what is happening?');
    assert.equal(transcript[1]?.role, 'ceo');
    assert.match(transcript[1]?.text || '', /ready/i);
});

test('jaw-ceo-docs-edit allows approved markdown and rejects code paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jaw-ceo-docs-'));
    const docs = path.join(root, 'docs');
    await mkdir(docs, { recursive: true });
    const readme = path.join(root, 'README.md');
    await writeFile(readme, '# Root\n', 'utf8');
    const policy = buildJawCeoDocsEditPolicy({ repoRoot: root, dashboardNotesRoot: path.join(root, 'notes') });

    await applyJawCeoDocsEdit({
        targetPath: path.join(docs, 'jaw-ceo-note.md'),
        operation: 'append_section',
        content: '## Jaw CEO\nReady.',
        policy,
    });
    assert.match(await readFile(path.join(docs, 'jaw-ceo-note.md'), 'utf8'), /## Jaw CEO/);

    await assert.rejects(
        () => applyJawCeoDocsEdit({
            targetPath: path.join(root, 'src', 'foo.ts'),
            operation: 'append_section',
            content: 'export const x = 1;',
            policy,
        }),
        /code, config, script, or package metadata/,
    );
});

test('jaw-ceo-confirmations reject replay and mismatched args', () => {
    const argsHash = hashConfirmationArgs({ action: 'instance.stop', port: 3457 });
    const record = createConfirmationRecord({
        action: 'instance.stop',
        argsHash,
        targetPort: 3457,
        sessionId: 'ceo_1',
        now: fixedNow(),
    });
    assert.deepEqual(validateConfirmationRecord({
        record,
        action: 'instance.stop',
        argsHash,
        targetPort: 3457,
        sessionId: 'ceo_1',
        now: fixedNow(),
    }), { ok: true });
    assert.equal(validateConfirmationRecord({
        record: { ...record, consumedAt: fixedNow().toISOString() },
        action: 'instance.stop',
        argsHash,
        targetPort: 3457,
        sessionId: 'ceo_1',
        now: fixedNow(),
    }).ok, false);
    assert.equal(validateConfirmationRecord({
        record,
        action: 'instance.stop',
        argsHash: 'wrong',
        targetPort: 3457,
        sessionId: 'ceo_1',
        now: fixedNow(),
    }).ok, false);
});

test('jaw-ceo-lifecycle realtime tools require confirmation before destructive actions', async () => {
    const executed: string[] = [];
    const coordinator = new JawCeoCoordinator({
        repoRoot: process.cwd(),
        now: fixedNow,
        store: createJawCeoStore({ now: fixedNow }),
        runLifecycleAction: async ({ action, port }) => {
            executed.push(`${action}:${port}`);
            return { ok: true, message: `${action} :${port}`, data: { action, port } };
        },
    });

    const restart = await coordinator.executeRealtimeTool('instance.restart', { port: 3457, reason: 'refresh worker' });
    assert.equal(restart.ok, true);
    assert.deepEqual(executed, ['restart:3457']);

    const rejected = await coordinator.executeRealtimeTool('instance.stop', { port: 3457, reason: 'stale worker' });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error?.code, 'confirmation_required');
    assert.deepEqual(executed, ['restart:3457']);

    const sessionId = coordinator.store.getSession().sessionId;
    const argsHash = hashConfirmationArgs({
        action: 'instance.stop',
        port: 3457,
        reason: 'stale worker',
    });
    const record = createConfirmationRecord({
        action: 'instance.stop',
        argsHash,
        targetPort: 3457,
        sessionId,
        now: fixedNow(),
    });
    coordinator.store.addConfirmation(record);

    const stopped = await coordinator.executeRealtimeTool('instance.stop', {
        port: 3457,
        reason: 'stale worker',
        confirmationRecordId: record.id,
    });
    assert.equal(stopped.ok, true);
    assert.deepEqual(executed, ['restart:3457', 'stop:3457']);
    assert.ok(coordinator.store.getConfirmation(record.id)?.consumedAt);
});

test('jaw-ceo realtime schemas use OpenAI-compatible tool names', () => {
    const tools = buildJawCeoRealtimeToolSchemas('manage');
    assert.ok(tools.length > 0);
    for (const tool of tools) {
        assert.match(tool.name, /^[a-zA-Z0-9_-]+$/);
        assert.equal(tool.name.includes('.'), false);
    }
    assert.ok(tools.some(tool => tool.name === 'dashboard_list_instances'));
    assert.ok(tools.some(tool => tool.name === 'instance_send_message'));
    assert.ok(tools.some(tool => tool.name === 'ceo_continue_completion'));
});

test('jaw-ceo realtime session config enables spoken assistant responses and preprompt', () => {
    const config = buildJawCeoRealtimeSessionConfig('manage');
    const audio = config["audio"] as { input?: { turn_detection?: Record<string, unknown> }; output?: { voice?: string } };
    const turnDetection = audio.input?.turn_detection;

    assert.deepEqual(config["output_modalities"], ['audio']);
    assert.equal(turnDetection?.["type"], 'server_vad');
    assert.equal(turnDetection?.["create_response"], true);
    assert.equal(turnDetection?.["interrupt_response"], true);
    assert.equal(typeof audio.output?.voice, 'string');
    assert.match(String(config["instructions"] || ''), /ceo_get_pending_completions/);
    assert.match(String(config["instructions"] || ''), /ceo_continue_completion/);
    assert.match(String(config["instructions"] || ''), /Speak Korean by default/);
});

test('jaw-ceo realtime continue response modes map to explicit output behavior', () => {
    assert.equal(buildJawCeoRealtimeResponseCreateEvent('ceo_continue_completion', { mode: 'silent' }), null);
    assert.deepEqual(buildJawCeoRealtimeResponseCreateEvent('ceo_continue_completion', { mode: 'text' }), {
        type: 'response.create',
        response: { modalities: ['text'] },
    });
    assert.deepEqual(buildJawCeoRealtimeResponseCreateEvent('ceo_continue_completion', { mode: 'voice' }), {
        type: 'response.create',
        response: { modalities: ['audio'] },
    });
    assert.deepEqual(buildJawCeoRealtimeResponseCreateEvent('ceo_continue_completion', { mode: 'both' }), {
        type: 'response.create',
        response: { modalities: ['text', 'audio'] },
    });
    assert.deepEqual(buildJawCeoRealtimeResponseCreateEvent('dashboard_list_instances', {}), {
        type: 'response.create',
    });
});
