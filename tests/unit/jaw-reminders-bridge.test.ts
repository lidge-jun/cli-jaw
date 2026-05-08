// jaw-reminders-bridge — unit tests for snapshot validation + file loading

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  loadJawRemindersSnapshot,
  resolveDefaultSnapshotPath,
  validateReminderSnapshot,
  watchJawRemindersSnapshot,
} from '../../src/reminders/jaw-reminders-bridge.ts';
import type { ReminderSnapshot } from '../../src/reminders/types.ts';

const VALID_SNAPSHOT: ReminderSnapshot = {
  schemaVersion: 1,
  lists: [{ id: 'today', name: 'Today', accent: '#ff0' }],
  reminders: [
    {
      id: 'r1',
      title: 'A',
      notes: '',
      listId: 'today',
      status: 'open',
      priority: 'normal',
      dueAt: null,
      remindAt: null,
      linkedInstance: null,
      subtasks: [],
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
    },
  ],
};

test('validateReminderSnapshot accepts a well-formed snapshot', () => {
  const result = validateReminderSnapshot(VALID_SNAPSHOT);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.reminders.length, 1);
    assert.equal(result.snapshot.lists[0]?.id, 'today');
  }
});

test('validateReminderSnapshot rejects non-object root', () => {
  const result = validateReminderSnapshot('nope');
  assert.equal(result.ok, false);
});

test('validateReminderSnapshot rejects missing schemaVersion', () => {
  const result = validateReminderSnapshot({ lists: [], reminders: [] });
  assert.equal(result.ok, false);
});

test('validateReminderSnapshot rejects invalid status', () => {
  const bad = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  bad.reminders[0].status = 'banana';
  const result = validateReminderSnapshot(bad);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /invalid status/);
  }
});

test('validateReminderSnapshot rejects subtask without id', () => {
  const bad = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  bad.reminders[0].subtasks = [{ title: 'no-id', done: false }];
  const result = validateReminderSnapshot(bad);
  assert.equal(result.ok, false);
});

test('validateReminderSnapshot enforces source invariants from jaw-reminders', () => {
  const duplicateList = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  duplicateList.lists.push({ id: 'today', name: 'Duplicate', accent: '#fff' });
  assert.equal(validateReminderSnapshot(duplicateList).ok, false);

  const unknownList = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  unknownList.reminders[0].listId = 'missing';
  assert.equal(validateReminderSnapshot(unknownList).ok, false);

  const focusedTwice = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  focusedTwice.reminders[0].status = 'focused';
  focusedTwice.reminders.push({ ...focusedTwice.reminders[0], id: 'r2' });
  assert.equal(validateReminderSnapshot(focusedTwice).ok, false);

  const emptyTitle = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  emptyTitle.reminders[0].title = '   ';
  assert.equal(validateReminderSnapshot(emptyTitle).ok, false);

  const blankListId = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  blankListId.lists[0].id = '   ';
  blankListId.reminders[0].listId = '   ';
  assert.equal(validateReminderSnapshot(blankListId).ok, false);

  const blankListName = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  blankListName.lists[0].name = '   ';
  assert.equal(validateReminderSnapshot(blankListName).ok, false);

  const blankReminderId = JSON.parse(JSON.stringify(VALID_SNAPSHOT));
  blankReminderId.reminders[0].id = '   ';
  assert.equal(validateReminderSnapshot(blankReminderId).ok, false);
});

test('validateReminderSnapshot rejects leading or trailing whitespace in source identifiers', () => {
  for (const mutate of [
    (bad: ReminderSnapshot) => { bad.lists[0]!.id = ' today'; bad.reminders[0]!.listId = ' today'; },
    (bad: ReminderSnapshot) => { bad.lists[0]!.name = 'Today '; },
    (bad: ReminderSnapshot) => { bad.reminders[0]!.id = ' r1'; },
    (bad: ReminderSnapshot) => { bad.reminders[0]!.title = 'A '; },
    (bad: ReminderSnapshot) => { bad.reminders[0]!.listId = 'today '; },
  ]) {
    const bad = JSON.parse(JSON.stringify(VALID_SNAPSHOT)) as ReminderSnapshot;
    mutate(bad);
    assert.equal(validateReminderSnapshot(bad).ok, false);
  }
});

test('loadJawRemindersSnapshot returns missing_file when no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaw-bridge-'));
  try {
    const status = await loadJawRemindersSnapshot({
      sourcePath: join(dir, 'does-not-exist.json'),
    });
    assert.equal(status.ok, false);
    if (!status.ok) {
      assert.equal(status.code, 'missing_file');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadJawRemindersSnapshot returns invalid_json when JSON broken', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaw-bridge-'));
  const path = join(dir, 'reminders.json');
  writeFileSync(path, '{not json}', 'utf8');
  try {
    const status = await loadJawRemindersSnapshot({ sourcePath: path });
    assert.equal(status.ok, false);
    if (!status.ok) {
      assert.equal(status.code, 'invalid_json');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadJawRemindersSnapshot returns schema_mismatch on bad shape', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaw-bridge-'));
  const path = join(dir, 'reminders.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, lists: [{ id: 'today', name: 'Today', accent: '#ff0' }], reminders: 'oops' }), 'utf8');
  try {
    const status = await loadJawRemindersSnapshot({ sourcePath: path });
    assert.equal(status.ok, false);
    if (!status.ok) {
      assert.equal(status.code, 'schema_mismatch');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadJawRemindersSnapshot returns ok with the snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaw-bridge-'));
  const path = join(dir, 'reminders.json');
  writeFileSync(path, JSON.stringify(VALID_SNAPSHOT), 'utf8');
  try {
    const status = await loadJawRemindersSnapshot({ sourcePath: path });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.snapshot.reminders[0]?.title, 'A');
      assert.equal(status.sourcePath, path);
      assert.match(status.loadedAt, /\d{4}-\d{2}-\d{2}T/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveDefaultSnapshotPath honors env override', () => {
  const original = process.env['JAW_REMINDERS_SNAPSHOT_PATH'];
  process.env['JAW_REMINDERS_SNAPSHOT_PATH'] = '/tmp/custom-bridge.json';
  try {
    assert.equal(resolveDefaultSnapshotPath(), '/tmp/custom-bridge.json');
  } finally {
    if (original === undefined) {
      delete process.env['JAW_REMINDERS_SNAPSHOT_PATH'];
    } else {
      process.env['JAW_REMINDERS_SNAPSHOT_PATH'] = original;
    }
  }
});

test('resolveDefaultSnapshotPath uses Tauri identifier on darwin', () => {
  const original = process.env['JAW_REMINDERS_SNAPSHOT_PATH'];
  delete process.env['JAW_REMINDERS_SNAPSHOT_PATH'];
  try {
    if (process.platform === 'darwin') {
      const path = resolveDefaultSnapshotPath();
      assert.ok(path);
      assert.match(path!, /ai\.lidge\.jaw\.reminders\/reminders\.json$/);
    }
  } finally {
    if (original !== undefined) {
      process.env['JAW_REMINDERS_SNAPSHOT_PATH'] = original;
    }
  }
});

test('watchJawRemindersSnapshot emits repeated schema errors when the error detail changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaw-bridge-watch-'));
  const path = join(dir, 'reminders.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, lists: [{ id: 'today', name: 'Today', accent: '#ff0' }], reminders: 'oops' }), 'utf8');
  try {
    const seen: string[] = [];
    let stop: (() => void) | null = null;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stop?.();
        reject(new Error(`watch timed out after ${seen.length} event(s)`));
      }, 1600);
      stop = watchJawRemindersSnapshot({ sourcePath: path, pollIntervalMs: 500 }, (status) => {
        if (!status.ok) seen.push(status.message);
        if (seen.length === 1) {
          writeFileSync(path, JSON.stringify({ schemaVersion: 1, lists: 'oops', reminders: [] }), 'utf8');
        }
        if (seen.length === 2) {
          clearTimeout(timeout);
          stop?.();
          resolve();
        }
      });
    });
    assert.equal(seen.length, 2);
    assert.match(seen[0] || '', /reminders must be an array/);
    assert.match(seen[1] || '', /lists must be an array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
