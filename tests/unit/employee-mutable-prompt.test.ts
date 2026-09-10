// #442: --mutable must actually change what the employee is told.
//
// The override is a string replace against employee.md. When that template was
// reworded the pattern kept matching the OLD sentence, so the replace silently
// did nothing and a Boss who granted writes still handed the employee a prompt
// saying writes were blocked. A source-level regex test would not have caught it
// either — only comparing the two rendered prompts does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmployeePromptV2, clearPromptCache } from '../../src/prompt/builder.ts';

const emp = { name: 'reviewer', role: 'reviewer', id: 1 };

test('EMP-442a: --mutable removes the write-blocked line', () => {
    clearPromptCache();
    const readOnly = String(getEmployeePromptV2(emp, 'reviewer', 1, {}));
    clearPromptCache();
    const mutable = String(getEmployeePromptV2(emp, 'reviewer', 1, { mutable: true }));

    assert.match(readOnly, /File writes are blocked/,
        'the read-only prompt must state the restriction');
    assert.doesNotMatch(mutable, /File writes are blocked/,
        'granting --mutable must not leave the employee reading a blanket prohibition');
    assert.match(mutable, /authorized to create or modify files/);
});

test('EMP-442b: a scope is named in the authorization when one is given', () => {
    clearPromptCache();
    const scoped = String(getEmployeePromptV2(emp, 'reviewer', 1, { mutable: true, scope: 'src/messaging' }));
    assert.match(scoped, /inside `src\/messaging`/);
});

test('full API authority and provider Safe are independent, including cached prompts', () => {
    clearPromptCache();
    const full = String(getEmployeePromptV2(emp, 'reviewer', 3,
        { fullAccess: true, allowDispatch: true, mutable: true, permissions: 'safe' }));
    assert.match(full, /## Jaw API Access/);
    assert.match(full, /Provider approval mode: safe/);
    assert.match(full, /Jaw dispatch is available/);
    assert.doesNotMatch(full, /File writes are blocked|must NEVER re-dispatch|Do NOT run `cli-jaw dispatch`/);
    assert.doesNotMatch(full, /Protected paths \(\.git, \.env, settings.json\) remain blocked/);
    const scoped = String(getEmployeePromptV2(emp, 'reviewer', 3, { mutable: true, permissions: 'safe' }));
    assert.doesNotMatch(scoped, /## Jaw API Access/);
    assert.match(scoped, /must NEVER re-dispatch/);
    const automatic = String(getEmployeePromptV2(emp, 'reviewer', 3,
        { fullAccess: true, allowDispatch: true, mutable: true, permissions: 'auto' }));
    assert.match(automatic, /Provider approval mode: auto/);
});

test('full worker read-only and descendant constraints remain independent', () => {
    clearPromptCache();
    const readonly = String(getEmployeePromptV2(emp, 'reviewer', 3,
        { fullAccess: true, allowDispatch: true, mutable: false, permissions: 'auto' }));
    assert.match(readonly, /File writes are blocked/);
    assert.match(readonly, /Jaw dispatch is available/);
    const leaf = String(getEmployeePromptV2(emp, 'reviewer', 3,
        { fullAccess: true, allowDispatch: false, noDescendants: true, mutable: true, permissions: 'auto' }));
    assert.match(leaf, /authorized to create or modify files/);
    assert.match(leaf, /assignment forbids child agents/);
    assert.doesNotMatch(leaf, /You CAN use.*(?:Task\/Agent|sub-agent)/);
    const scopedLeaf = String(getEmployeePromptV2(emp, 'reviewer', 3, { noDescendants: true }));
    assert.match(scopedLeaf, /assignment forbids child agents/);
    assert.doesNotMatch(scopedLeaf, /You CAN use.*(?:Task\/Agent|sub-agent)/);
});

test('policy rendering preserves literal task data rather than interpreting it as template rules', () => {
    clearPromptCache();
    const role = 'File writes are blocked unless the Boss explicitly grants `--mutable`.';
    const scope = 'src/{{EMP_NAME}}';
    const prompt = String(getEmployeePromptV2({ ...emp, role }, 'reviewer', 3,
        { fullAccess: true, allowDispatch: true, mutable: true, scope, permissions: 'auto' }));
    assert.ok(prompt.includes(`Role: ${role}`));
    assert.ok(prompt.includes(`inside \`${scope}\``));
});
