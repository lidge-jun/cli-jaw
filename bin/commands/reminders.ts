import { parseArgs } from 'node:util';
import { addReminderForCli, formatReminder, listRemindersForCli, markReminderDoneForCli } from '../../src/cli/reminders.js';
import type { ReminderPriority } from '../../src/reminders/types.js';

const subcommand = process.argv[3] || 'list';

const { values, positionals } = parseArgs({
    args: process.argv.slice(4),
    options: {
        json: { type: 'boolean', default: false },
        title: { type: 'string' },
        notes: { type: 'string' },
        priority: { type: 'string' },
        due: { type: 'string' },
        remind: { type: 'string' },
        port: { type: 'string' },
        'message-id': { type: 'string' },
        'instance-id': { type: 'string' },
        'turn-index': { type: 'string' },
        thread: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
});

function printJson(value: unknown): void {
    console.log(JSON.stringify(value));
}

function exitWith(result: { ok: boolean; error?: string; code?: string }): void {
    if (result.ok) return;
    if (values.json) printJson(result);
    else console.error(`  ❌ ${result.error || result.code || 'reminders command failed'}`);
    process.exitCode = 1;
}

function stringOption(value: string | boolean | undefined): string | null {
    return typeof value === 'string' ? value : null;
}

function priorityOption(value: string | boolean | undefined): ReminderPriority {
    return value === 'low' || value === 'normal' || value === 'high' ? value : 'normal';
}

switch (subcommand) {
    case 'list':
    case 'ls': {
        const result = listRemindersForCli();
        if (values.json) printJson(result);
        else {
            if (!result.ok) exitWith(result);
            else if (result.action === 'list' && result.items.length === 0) console.log('  No reminders found.');
            else if (result.action === 'list') for (const item of result.items) console.log(`  ${formatReminder(item)}`);
        }
        break;
    }
    case 'add': {
        const title = stringOption(values.title) || positionals.join(' ');
        const notes = stringOption(values.notes);
        const dueAt = stringOption(values.due);
        const remindAt = stringOption(values.remind);
        const threadKey = stringOption(values.thread);
        const portOption = stringOption(values.port);
        const port = portOption ? Number(portOption) : null;
        const messageId = stringOption(values['message-id']);
        const instanceId = stringOption(values['instance-id']) || (port ? `port:${port}` : null);
        const result = addReminderForCli({
            title,
            notes,
            priority: priorityOption(values.priority),
            dueAt,
            remindAt,
            linkedInstance: port ? String(port) : null,
            link: instanceId && messageId ? {
                instanceId,
                messageId,
                turnIndex: stringOption(values['turn-index']) ? Number(stringOption(values['turn-index'])) : null,
                port,
                threadKey,
                sourceText: notes,
            } : null,
        });
        if (values.json) printJson(result);
        else if (result.ok && result.action === 'add') console.log(`  Added ${formatReminder(result.item)}`);
        exitWith(result);
        break;
    }
    case 'done': {
        const id = positionals[0] || '';
        const result = markReminderDoneForCli(id);
        if (values.json) printJson(result);
        else if (result.ok && result.action === 'done') console.log(`  Done ${formatReminder(result.item)}`);
        exitWith(result);
        break;
    }
    default:
        console.error(`  ❌ Unknown reminders command: ${subcommand}`);
        console.error('  Usage: jaw reminders [list|add|done] [--json]');
        process.exitCode = 1;
}
