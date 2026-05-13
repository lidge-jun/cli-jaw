import { parseArgs } from 'node:util';
import {
    connectorBoardAdd,
    connectorBoardUpdate,
    connectorBoardList,
    connectorNotesWrite,
    connectorNotesList,
    connectorAudit,
    type ConnectorCliResult,
} from '../../src/cli/connector.js';
import {
    listRemindersForCli,
    addReminderForCli,
    markReminderDoneForCli,
    formatReminder,
} from '../../src/cli/reminders.js';
import type { ReminderPriority } from '../../src/reminders/types.js';

const surface = process.argv[3] || '--help';
const subcommand = process.argv[4] || '';

const { values, positionals } = parseArgs({
    args: process.argv.slice(5),
    options: {
        json: { type: 'boolean', default: false },
        title: { type: 'string' },
        summary: { type: 'string' },
        lane: { type: 'string' },
        path: { type: 'string' },
        body: { type: 'string' },
        notes: { type: 'string' },
        priority: { type: 'string' },
        due: { type: 'string' },
        remind: { type: 'string' },
        limit: { type: 'string' },
        port: { type: 'string' },
        'message-id': { type: 'string' },
        'instance-id': { type: 'string' },
        'turn-index': { type: 'string' },
        thread: { type: 'string' },
        help: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
});

function printJson(v: unknown): void { console.log(JSON.stringify(v, null, 2)); }

function printResult(result: ConnectorCliResult): void {
    if (!result.ok) {
        if (values.json) printJson(result);
        else console.error(`  ❌ [${result.code}] ${result.error}`);
        process.exitCode = 1;
        return;
    }
    if (values.json) printJson(result.data);
    else console.log(JSON.stringify(result.data, null, 2));
}

function str(v: string | boolean | undefined): string | null {
    return typeof v === 'string' ? v : null;
}

const HELP = `Dashboard Connector CLI — unified entry point for board, notes, and reminders.

Surfaces:
  board       Kanban board tasks (backlog/ready/active/review/done)
  notes       Dashboard markdown notes
  reminders   Priority-based reminders (alias: cli-jaw reminders)
  audit       Connector audit log

Board commands:
  connector board add --title "..." [--summary "..."] [--lane backlog]
  connector board update <id> [--title "..."] [--lane done]
  connector board list [--json]

Notes commands:
  connector notes write --path "path/to/note.md" --body "content"
  connector notes list [--json]

Reminders commands (delegates to cli-jaw reminders):
  connector reminders add "title" [--priority high] [--due ISO] [--remind ISO]
  connector reminders list [--json]
  connector reminders done <id>

Audit:
  connector audit [--limit 50] [--json]

Flags:
  --json    Output as JSON (default: human-readable)
  --help    Show this help

Board/notes/audit require Manager running (port 24576 or DASHBOARD_PORT env).
Reminders work offline via local store.`;

if (surface === '--help' || surface === '-h' || values.help) {
    console.log(HELP);
    process.exit(0);
}

async function run(): Promise<void> {
    switch (surface) {
        case 'board': {
            switch (subcommand) {
                case 'add': {
                    const title = str(values.title) || positionals.join(' ');
                    if (!title) { console.error('  ❌ --title required'); process.exitCode = 1; return; }
                    printResult(await connectorBoardAdd({
                        title,
                        summary: str(values.summary) ?? undefined,
                        lane: str(values.lane) ?? undefined,
                    }));
                    return;
                }
                case 'update': {
                    const id = positionals[0] || '';
                    if (!id) { console.error('  ❌ <id> required'); process.exitCode = 1; return; }
                    printResult(await connectorBoardUpdate(id, {
                        title: str(values.title) ?? undefined,
                        summary: str(values.summary) ?? undefined,
                        lane: str(values.lane) ?? undefined,
                    }));
                    return;
                }
                case 'list':
                case 'ls':
                    printResult(await connectorBoardList());
                    return;
                default:
                    console.error(`  ❌ Unknown board command: ${subcommand}`);
                    console.error('  Usage: connector board [add|update|list]');
                    process.exitCode = 1;
                    return;
            }
        }
        case 'notes': {
            switch (subcommand) {
                case 'write': {
                    const path = str(values.path) || '';
                    const body = str(values.body) || '';
                    if (!path) { console.error('  ❌ --path required'); process.exitCode = 1; return; }
                    printResult(await connectorNotesWrite({ path, body }));
                    return;
                }
                case 'list':
                case 'ls':
                    printResult(await connectorNotesList());
                    return;
                default:
                    console.error(`  ❌ Unknown notes command: ${subcommand}`);
                    console.error('  Usage: connector notes [write|list]');
                    process.exitCode = 1;
                    return;
            }
        }
        case 'reminders': {
            const remSub = subcommand || 'list';
            switch (remSub) {
                case 'list':
                case 'ls': {
                    const result = listRemindersForCli();
                    if (values.json) printJson(result);
                    else if (!result.ok) { console.error(`  ❌ ${result.error}`); process.exitCode = 1; }
                    else if (result.action === 'list' && result.items.length === 0) console.log('  No reminders found.');
                    else if (result.action === 'list') for (const item of result.items) console.log(`  ${formatReminder(item)}`);
                    return;
                }
                case 'add': {
                    const title = str(values.title) || positionals.join(' ');
                    const priority = (values.priority === 'low' || values.priority === 'normal' || values.priority === 'high'
                        ? values.priority : 'normal') as ReminderPriority;
                    const result = addReminderForCli({
                        title,
                        notes: str(values.notes),
                        priority,
                        dueAt: str(values.due),
                        remindAt: str(values.remind),
                        linkedInstance: str(values.port) ? String(values.port) : null,
                        link: null,
                    });
                    if (values.json) printJson(result);
                    else if (result.ok && result.action === 'add') console.log(`  Added ${formatReminder(result.item)}`);
                    else if (!result.ok) { console.error(`  ❌ ${result.error}`); process.exitCode = 1; }
                    return;
                }
                case 'done': {
                    const id = positionals[0] || '';
                    const result = markReminderDoneForCli(id);
                    if (values.json) printJson(result);
                    else if (result.ok && result.action === 'done') console.log(`  Done ${formatReminder(result.item)}`);
                    else if (!result.ok) { console.error(`  ❌ ${result.error}`); process.exitCode = 1; }
                    return;
                }
                default:
                    console.error(`  ❌ Unknown reminders command: ${remSub}`);
                    console.error('  Usage: connector reminders [add|list|done]');
                    process.exitCode = 1;
                    return;
            }
        }
        case 'audit': {
            const limit = str(values.limit) ? Number(values.limit) : 50;
            printResult(await connectorAudit(limit));
            return;
        }
        default:
            console.error(`  ❌ Unknown surface: ${surface}`);
            console.log(HELP);
            process.exitCode = 1;
    }
}

run().catch((e: unknown) => {
    console.error(`  ❌ ${(e as Error).message}`);
    process.exitCode = 1;
});
