// The script runner's environment. The whole point of the surrounding code is to
// hand a child ONE scoped secret; spreading process.env underneath it handed the
// same child every channel credential the host had, which made the scoped grant
// decoration.
import test from 'node:test';
import assert from 'node:assert/strict';

import { heartbeatScriptEnv } from '../../src/memory/heartbeat.ts';
import { SLACK_TOOL_GRANT_ENV } from '../../src/slack/tool-context.ts';

test('HSE-001 channel credentials are not inherited by a heartbeat script', () => {
    const env = heartbeatScriptEnv({
        PATH: '/usr/bin',
        SLACK_BOT_TOKEN: 'xoxb-secret',
        SLACK_APP_TOKEN: 'xapp-secret',
        TELEGRAM_BOT_TOKEN: 'telegram-secret',
        DISCORD_BOT_TOKEN: 'discord-secret',
    }, {});

    assert.equal(env['PATH'], '/usr/bin', 'ordinary environment still reaches the child');
    for (const leaked of ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN']) {
        assert.equal(env[leaked], undefined, leaked + ' must not be inherited');
    }
});

test('HSE-002 the scoped grant survives the filter, because it is applied after it', () => {
    // The one secret this path is SUPPOSED to hand over. Filtering it out would
    // break the feature the filter exists to protect.
    const env = heartbeatScriptEnv(
        { SLACK_BOT_TOKEN: 'xoxb-secret' },
        { [SLACK_TOOL_GRANT_ENV]: 'grant-secret' },
    );
    assert.equal(env[SLACK_TOOL_GRANT_ENV], 'grant-secret');
    assert.equal(env['SLACK_BOT_TOKEN'], undefined);
});

test('HSE-003 the filter is by prefix, so a channel variable added later is excluded by default', () => {
    const env = heartbeatScriptEnv({ SLACK_SOMETHING_INVENTED_TOMORROW: 'x', UNRELATED_TOKEN: 'y' }, {});
    assert.equal(env['SLACK_SOMETHING_INVENTED_TOMORROW'], undefined);
    assert.equal(env['UNRELATED_TOKEN'], 'y', 'the filter must not swallow unrelated configuration');
});
