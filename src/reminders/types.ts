/**
 * Read-only mirror of the jaw-reminders Tauri schema.
 * Source of truth: jaw-reminders/src-tauri/src/reminders/domain.rs (camelCase serde).
 * This file MUST stay in sync with that schema. Do not add cli-jaw-only fields here.
 */

export type ReminderStatus = 'open' | 'focused' | 'waiting' | 'done';
export type ReminderPriority = 'low' | 'normal' | 'high';

export interface ReminderList {
  id: string;
  name: string;
  accent: string;
}

export interface ReminderSubtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Reminder {
  id: string;
  title: string;
  notes: string;
  listId: string;
  status: ReminderStatus;
  priority: ReminderPriority;
  dueAt: string | null;
  remindAt: string | null;
  linkedInstance: string | null;
  subtasks: ReminderSubtask[];
  createdAt: string;
  updatedAt: string;
}

export interface ReminderSnapshot {
  schemaVersion: number;
  lists: ReminderList[];
  reminders: Reminder[];
}

export type JawRemindersBridgeStatusOk = {
  ok: true;
  snapshot: ReminderSnapshot;
  sourcePath: string;
  loadedAt: string;
};

export type JawRemindersBridgeErrorCode =
  | 'missing_file'
  | 'invalid_json'
  | 'schema_mismatch'
  | 'read_failed'
  | 'platform_unsupported';

export type JawRemindersBridgeStatusError = {
  ok: false;
  code: JawRemindersBridgeErrorCode;
  message: string;
  sourcePath: string;
  loadedAt: string;
};

export type JawRemindersBridgeStatus =
  | JawRemindersBridgeStatusOk
  | JawRemindersBridgeStatusError;

export type JawRemindersBridgeStatusListener = (status: JawRemindersBridgeStatus) => void;
