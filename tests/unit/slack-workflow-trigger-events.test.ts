import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isSlackMention,
    matchingTrustedBotTriggers,
    matchesTrustedBotTrigger,
    readTrustedBotTriggers,
    shouldProcessSlackEvent,
    type SlackGateConfig,
    type SlackMessageEvent,
} from '../../src/slack/events.ts';

const SELF = 'U0SELF001';
const LEGACY = { channelId: 'C0EXAMPLE', botId: 'B0EXAMPLE', userId: 'U0EXAMPLE', textMarker: 'EXAMPLE_READY_V1' };
const WORKFLOW = { ...LEGACY, workflowSkill: 'example-workflow.v2' };

function config(trustedBotTriggers: unknown = [WORKFLOW]): SlackGateConfig {
    return {
        selfUserId: SELF, allowBots: false, mentionOnly: true,
        channelIds: [], threadRequireMention: false,
        threadParticipation: () => null, trustedBotTriggers,
    };
}

function event(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
    return {
        type: 'message', subtype: 'bot_message', channel: LEGACY.channelId,
        bot_id: LEGACY.botId, user: LEGACY.userId,
        text: `<@${SELF}> EXAMPLE_READY_V1 ready`, ...overrides,
    };
}

test('legacy rules retain their exact four-field shape', () => {
    assert.deepEqual(readTrustedBotTriggers([LEGACY]), [LEGACY]);
    assert.deepEqual(matchingTrustedBotTriggers(event(), config([LEGACY])), [LEGACY]);
    assert.equal(matchesTrustedBotTrigger(event(), config([LEGACY])), true);
    assert.deepEqual(shouldProcessSlackEvent(event(), config([LEGACY]), 'events_api'), { process: true });
});

test('all matching workflows survive in order for caller-owned ambiguity resolution', () => {
    const otherWorkflow = { ...LEGACY, workflowSkill: 'example-other' };
    const otherMarker = { ...WORKFLOW, textMarker: 'EXAMPLE_SECOND_V1' };
    const unmatched = { ...WORKFLOW, channelId: 'C0OTHER01' };
    const rules = [unmatched, WORKFLOW, LEGACY, otherWorkflow, otherMarker, WORKFLOW];
    assert.deepEqual(readTrustedBotTriggers(rules), rules);
    assert.deepEqual(
        matchingTrustedBotTriggers(event({ text: `<@${SELF}|Example>\nEXAMPLE_READY_V1\tEXAMPLE_SECOND_V1` }), config(rules)),
        [WORKFLOW, LEGACY, otherWorkflow, otherMarker, WORKFLOW],
    );
    assert.deepEqual(matchingTrustedBotTriggers(event(), config(rules)), [WORKFLOW, LEGACY, otherWorkflow, WORKFLOW]);
    assert.equal(matchesTrustedBotTrigger(event(), config(rules)), true);
});

test('canonical skill IDs accepted by the existing skill contract are preserved', () => {
    for (const workflowSkill of ['example', 'example-workflow', 'example_workflow.v2', '2-example']) {
        const rule = { ...LEGACY, workflowSkill };
        assert.deepEqual(readTrustedBotTriggers([rule]), [rule]);
    }
});

for (const [label, workflowSkill] of [
    ['undefined', undefined], ['null', null], ['number', 42], ['boolean', true],
    ['array', ['example']], ['object', {}], ['boxed string', new String('example')],
    ['coercible object', { toString() { throw new Error('must not coerce'); } }],
    ['empty', ''], ['blank', ' '], ['leading space', ' example'], ['trailing space', 'example '],
    ['newline', 'example\n'], ['tab', '\texample'], ['uppercase', 'Example'],
    ['traversal', '../example'], ['embedded traversal', 'example..other'],
    ['absolute path', '/example'], ['slash', 'example/other'], ['backslash', 'example\\other'],
    ['drive path', 'C:\\example'], ['encoded path', '%2e%2e%2fexample'],
    ['NUL', 'example\0'], ['shell syntax', 'example;other'], ['colon', 'example:other'],
] as const) test(`invalid workflow ${label} voids every rule without throwing`, () => {
    const bad = { ...LEGACY, workflowSkill };
    for (const rules of [[bad], [WORKFLOW, bad], [bad, LEGACY]]) {
        assert.deepEqual(readTrustedBotTriggers(rules), []);
        assert.deepEqual(matchingTrustedBotTriggers(event(), config(rules)), []);
        assert.equal(matchesTrustedBotTrigger(event(), config(rules)), false);
        assert.deepEqual(shouldProcessSlackEvent(event(), config(rules), 'events_api'), {
            process: false, reason: 'subtype_bot_message',
        });
    }
});

test('unknown own fields and missing or inherited required fields void the whole list', () => {
    const badRows: unknown[] = [
        { ...WORKFLOW, extra: true }, { ...LEGACY, workflowSkills: 'example' },
        { ...WORKFLOW, [Symbol('extra')]: true },
        Object.defineProperty({ ...WORKFLOW }, 'extra', { value: true }),
        null, [], 'example',
    ];
    for (const key of ['channelId', 'botId', 'userId', 'textMarker'] as const) {
        const missing: Record<string, unknown> = { ...WORKFLOW };
        delete missing[key];
        badRows.push(missing, Object.assign(Object.create({ [key]: LEGACY[key] }), missing));
        for (const invalid of [null, undefined, 42, '', 'wrong']) badRows.push({ ...WORKFLOW, [key]: invalid });
    }
    for (const bad of badRows) {
        assert.deepEqual(readTrustedBotTriggers([WORKFLOW, bad]), []);
        assert.deepEqual(matchingTrustedBotTriggers(event(), config([WORKFLOW, bad])), []);
    }
});

test('absent, malformed and over-cap lists return no matches; the existing cap remains 16', () => {
    for (const rules of [undefined, null, {}, WORKFLOW, [], Array(1), Array(17).fill(WORKFLOW)]) {
        assert.deepEqual(readTrustedBotTriggers(rules), []);
        assert.deepEqual(matchingTrustedBotTriggers(event(), { ...config(), trustedBotTriggers: rules }), []);
    }
    assert.equal(readTrustedBotTriggers(Array(16).fill(WORKFLOW)).length, 16);
    assert.equal(matchingTrustedBotTriggers(event(), { ...config(), selfUserId: null }).length, 0);
});

for (const [label, overrides] of [
    ['wrong channel', { channel: 'C0OTHER01' }],
    ['wrong bot', { bot_id: 'B0OTHER01' }],
    ['wrong sender', { user: 'U0OTHER01' }],
    ['missing bot identity', { bot_id: '' }],
    ['missing sender identity', { user: '' }],
    ['self sender', { user: SELF }],
    ['deleted profile', { bot_profile: { id: LEGACY.botId, user_id: LEGACY.userId, deleted: true } }],
    ['disagreeing bot profile', { bot_profile: { id: 'B0OTHER01', user_id: LEGACY.userId } }],
    ['disagreeing sender profile', { bot_profile: { id: LEGACY.botId, user_id: 'U0OTHER01' } }],
    ['longer marker', { text: `<@${SELF}> EXAMPLE_READY_V1X` }],
    ['punctuated marker', { text: `<@${SELF}> EXAMPLE_READY_V1,` }],
    ['missing marker', { text: `<@${SELF}> ready` }],
    ['missing mention', { text: 'EXAMPLE_READY_V1 ready' }],
    ['another mention', { text: '<@U0OTHER01> EXAMPLE_READY_V1' }],
    ['longer mention ID', { text: `<@${SELF}X> EXAMPLE_READY_V1` }],
    ['app envelope without textual mention', { type: 'app_mention', text: 'EXAMPLE_READY_V1' }],
] satisfies [string, Partial<SlackMessageEvent>][]) test(`workflow rule refuses ${label}`, () => {
    const post = event(overrides);
    assert.deepEqual(matchingTrustedBotTriggers(post, config()), []);
    assert.equal(matchesTrustedBotTrigger(post, config()), false);
    assert.equal(shouldProcessSlackEvent(post, config(), 'events_api').process, false);
});

test('profile-only and agreeing top-level identities match exactly as legacy rules do', () => {
    const profile = { id: LEGACY.botId, user_id: LEGACY.userId };
    for (const post of [event({ bot_id: '', user: '', bot_profile: profile }), event({ bot_profile: profile })]) {
        assert.deepEqual(matchingTrustedBotTriggers(post, config()), [WORKFLOW]);
        assert.deepEqual(shouldProcessSlackEvent(post, config(), 'events_api'), { process: true });
    }
});

test('a self-naming workflow rule cannot match even through profile-only identity', () => {
    const selfRule = { ...WORKFLOW, userId: SELF };
    const post = event({ user: '', bot_profile: { id: LEGACY.botId, user_id: SELF } });
    assert.deepEqual(matchingTrustedBotTriggers(post, config([selfRule])), []);
});

test('workflow matching leaves narrow mentions and all unrelated gates intact', () => {
    const post = event();
    assert.equal(isSlackMention(post, SELF), false);
    assert.deepEqual(shouldProcessSlackEvent(post, config(), 'events_api'), { process: true });
    assert.deepEqual(shouldProcessSlackEvent(post, { ...config(), channelIds: ['C0OTHER01'] }, 'events_api'), {
        process: false, reason: 'channel_not_allowed',
    });
    for (const subtype of ['message_changed', 'message_deleted', 'channel_join']) {
        assert.deepEqual(shouldProcessSlackEvent(event({ subtype }), config(), 'events_api'), {
            process: false, reason: `subtype_${subtype}`,
        });
    }
});
