/**
 * Read-only file-based bridge to the jaw-reminders Tauri app.
 * Reads the snapshot file written by jaw-reminders' Rust storage layer
 * (see jaw-reminders/src-tauri/src/reminders/storage.rs).
 *
 * Tauri identifier: ai.lidge.jaw.reminders (jaw-reminders/src-tauri/tauri.conf.json:5)
 * Default macOS path: ~/Library/Application Support/ai.lidge.jaw.reminders/reminders.json
 *
 * Public API:
 *   loadJawRemindersSnapshot(options?)        Promise<JawRemindersBridgeStatus>
 *   watchJawRemindersSnapshot(options, onStatus)  () => void  (stop function)
 *   resolveDefaultSnapshotPath()              string | null
 */

import { promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type {
  JawRemindersBridgeStatus,
  JawRemindersBridgeStatusError,
  JawRemindersBridgeStatusListener,
  Reminder,
  ReminderList,
  ReminderSnapshot,
  ReminderSubtask,
} from './types.js';

const LOG_PREFIX = '[jaw-reminders-bridge]';
const TAURI_IDENTIFIER = 'ai.lidge.jaw.reminders';
const SNAPSHOT_FILENAME = 'reminders.json';
const DEFAULT_POLL_MS = 5000;
const MIN_POLL_MS = 500;

export interface JawRemindersBridgeOptions {
  sourcePath?: string;
}

export interface JawRemindersWatchOptions extends JawRemindersBridgeOptions {
  pollIntervalMs?: number;
}

export function resolveDefaultSnapshotPath(): string | null {
  const override = process.env['JAW_REMINDERS_SNAPSHOT_PATH'];
  if (override && override.trim().length > 0) {
    return override;
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', TAURI_IDENTIFIER, SNAPSHOT_FILENAME);
  }
  // Linux/Windows are not yet first-class targets for the bridge.
  // Consumers can still set JAW_REMINDERS_SNAPSHOT_PATH to opt in.
  return null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function fail(
  sourcePath: string,
  code: JawRemindersBridgeStatusError['code'],
  message: string,
): JawRemindersBridgeStatusError {
  console.warn(message);
  return { ok: false, code, message, sourcePath, loadedAt: nowIso() };
}

function parseSubtask(raw: unknown, reminderId: string): ReminderSubtask | string {
  if (typeof raw !== 'object' || raw === null) {
    return `reminder ${reminderId}: subtask is not an object`;
  }
  const record = raw as Record<string, unknown>;
  const id = record['id'];
  const title = record['title'];
  const done = record['done'];
  if (typeof id !== 'string' || id.length === 0) {
    return `reminder ${reminderId}: subtask id missing`;
  }
  if (typeof title !== 'string') {
    return `reminder ${reminderId}: subtask ${id} title missing`;
  }
  if (typeof done !== 'boolean') {
    return `reminder ${reminderId}: subtask ${id} done flag missing`;
  }
  return { id, title, done };
}

function parseList(raw: unknown): ReminderList | string {
  if (typeof raw !== 'object' || raw === null) {
    return 'list is not an object';
  }
  const record = raw as Record<string, unknown>;
  const id = record['id'];
  const name = record['name'];
  const accent = record['accent'];
  if (typeof id !== 'string' || id.trim().length === 0 || id !== id.trim()) {
    return 'list id missing';
  }
  if (typeof name !== 'string' || name.trim().length === 0 || name !== name.trim()) {
    return `list ${id} name missing`;
  }
  if (typeof accent !== 'string') {
    return `list ${id} accent missing`;
  }
  return { id, name, accent };
}

const STATUS_VALUES = new Set(['open', 'focused', 'waiting', 'done']);
const PRIORITY_VALUES = new Set(['low', 'normal', 'high']);

function ensureUnique(values: string[], label: string): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return `duplicate ${label}: ${value}`;
    seen.add(value);
  }
  return null;
}

function parseReminder(raw: unknown): Reminder | string {
  if (typeof raw !== 'object' || raw === null) {
    return 'reminder is not an object';
  }
  const record = raw as Record<string, unknown>;
  const id = record['id'];
  if (typeof id !== 'string' || id.trim().length === 0 || id !== id.trim()) {
    return 'reminder id missing';
  }
  const title = record['title'];
  if (typeof title !== 'string' || title.trim().length === 0 || title !== title.trim()) {
    return `reminder ${id}: title missing`;
  }
  const notes = record['notes'];
  if (typeof notes !== 'string') {
    return `reminder ${id}: notes missing`;
  }
  const listId = record['listId'];
  if (typeof listId !== 'string' || listId.trim().length === 0 || listId !== listId.trim()) {
    return `reminder ${id}: listId missing`;
  }
  const status = record['status'];
  if (typeof status !== 'string' || !STATUS_VALUES.has(status)) {
    return `reminder ${id}: invalid status`;
  }
  const priority = record['priority'];
  if (typeof priority !== 'string' || !PRIORITY_VALUES.has(priority)) {
    return `reminder ${id}: invalid priority`;
  }
  const dueAt = record['dueAt'];
  if (dueAt !== null && dueAt !== undefined && typeof dueAt !== 'string') {
    return `reminder ${id}: dueAt must be string or null`;
  }
  const remindAt = record['remindAt'];
  if (remindAt !== null && remindAt !== undefined && typeof remindAt !== 'string') {
    return `reminder ${id}: remindAt must be string or null`;
  }
  const linkedInstance = record['linkedInstance'];
  if (
    linkedInstance !== null &&
    linkedInstance !== undefined &&
    typeof linkedInstance !== 'string'
  ) {
    return `reminder ${id}: linkedInstance must be string or null`;
  }
  const createdAt = record['createdAt'];
  const updatedAt = record['updatedAt'];
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
    return `reminder ${id}: createdAt/updatedAt missing`;
  }
  const subtasksRaw = record['subtasks'];
  if (!Array.isArray(subtasksRaw)) {
    return `reminder ${id}: subtasks must be array`;
  }
  const subtasks: ReminderSubtask[] = [];
  for (const subRaw of subtasksRaw) {
    const parsed = parseSubtask(subRaw, id);
    if (typeof parsed === 'string') {
      return parsed;
    }
    subtasks.push(parsed);
  }
  return {
    id,
    title,
    notes,
    listId,
    status: status as Reminder['status'],
    priority: priority as Reminder['priority'],
    dueAt: (dueAt ?? null) as string | null,
    remindAt: (remindAt ?? null) as string | null,
    linkedInstance: (linkedInstance ?? null) as string | null,
    subtasks,
    createdAt,
    updatedAt,
  };
}

export function validateReminderSnapshot(
  raw: unknown,
): { ok: true; snapshot: ReminderSnapshot } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'snapshot is not an object' };
  }
  const record = raw as Record<string, unknown>;
  const schemaVersion = record['schemaVersion'];
  if (typeof schemaVersion !== 'number') {
    return { ok: false, error: 'schemaVersion missing or not a number' };
  }
  if (schemaVersion !== 1) {
    return { ok: false, error: 'unsupported schemaVersion' };
  }
  const listsRaw = record['lists'];
  if (!Array.isArray(listsRaw)) {
    return { ok: false, error: 'lists must be an array' };
  }
  if (listsRaw.length === 0) {
    return { ok: false, error: 'lists must not be empty' };
  }
  const remindersRaw = record['reminders'];
  if (!Array.isArray(remindersRaw)) {
    return { ok: false, error: 'reminders must be an array' };
  }
  const lists: ReminderList[] = [];
  for (const raw of listsRaw) {
    const parsed = parseList(raw);
    if (typeof parsed === 'string') {
      return { ok: false, error: parsed };
    }
    lists.push(parsed);
  }
  const reminders: Reminder[] = [];
  for (const raw of remindersRaw) {
    const parsed = parseReminder(raw);
    if (typeof parsed === 'string') {
      return { ok: false, error: parsed };
    }
    reminders.push(parsed);
  }
  const duplicateList = ensureUnique(lists.map(list => list.id), 'list id');
  if (duplicateList) return { ok: false, error: duplicateList };
  const duplicateReminder = ensureUnique(reminders.map(reminder => reminder.id), 'reminder id');
  if (duplicateReminder) return { ok: false, error: duplicateReminder };
  const listIds = new Set(lists.map(list => list.id));
  for (const reminder of reminders) {
    if (reminder.title.trim().length === 0) {
      return { ok: false, error: `reminder ${reminder.id}: title empty` };
    }
    if (!listIds.has(reminder.listId)) {
      return { ok: false, error: `reminder ${reminder.id}: unknown listId` };
    }
  }
  if (reminders.filter(reminder => reminder.status === 'focused').length > 1) {
    return { ok: false, error: 'at most one reminder may be focused' };
  }
  return {
    ok: true,
    snapshot: {
      schemaVersion,
      lists,
      reminders,
    },
  };
}

function snapshotChangeKey(status: JawRemindersBridgeStatus): string {
  if (!status.ok) {
    return `err:${status.code}:${status.sourcePath}:${status.message}`;
  }
  return JSON.stringify({
    sourcePath: status.sourcePath,
    schemaVersion: status.snapshot.schemaVersion,
    lists: status.snapshot.lists,
    reminders: status.snapshot.reminders,
  });
}

export async function loadJawRemindersSnapshot(
  options: JawRemindersBridgeOptions = {},
): Promise<JawRemindersBridgeStatus> {
  const sourcePath = options.sourcePath ?? resolveDefaultSnapshotPath();
  if (!sourcePath) {
    return fail(
      '',
      'platform_unsupported',
      `${LOG_PREFIX} no default snapshot path on platform ${platform()}; set JAW_REMINDERS_SNAPSHOT_PATH`,
    );
  }
  let raw: string;
  try {
    raw = await fs.readFile(sourcePath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return fail(sourcePath, 'missing_file', `${LOG_PREFIX} snapshot not found at ${sourcePath}`);
    }
    return fail(
      sourcePath,
      'read_failed',
      `${LOG_PREFIX} read failed: ${error.message ?? String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return fail(
      sourcePath,
      'invalid_json',
      `${LOG_PREFIX} JSON parse failed: ${(err as Error).message}`,
    );
  }
  const validation = validateReminderSnapshot(parsed);
  if (!validation.ok) {
    return fail(sourcePath, 'schema_mismatch', `${LOG_PREFIX} ${validation.error}`);
  }
  return {
    ok: true,
    snapshot: validation.snapshot,
    sourcePath,
    loadedAt: nowIso(),
  };
}

export function watchJawRemindersSnapshot(
  options: JawRemindersWatchOptions,
  onStatus: JawRemindersBridgeStatusListener,
): () => void {
  const interval = Math.max(MIN_POLL_MS, options.pollIntervalMs ?? DEFAULT_POLL_MS);
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let lastKey: string | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const status = await loadJawRemindersSnapshot(options);
    if (stopped) return;
    const key = snapshotChangeKey(status);
    if (key !== lastKey) {
      lastKey = key;
      try {
        onStatus(status);
      } catch (err) {
        // Listener errors must not stop the polling loop, but must be visible.
        console.error(`${LOG_PREFIX} listener threw:`, err);
      }
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void tick();
      }, interval);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
