import { readSource } from './source-normalize.js';
// LAN mode UX tests — Phase 1.1 (#108)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');
const serveSrc = readSource(join(projectRoot, 'bin/commands/serve.ts'), 'utf8');
const serverSrc = readSource(join(projectRoot, 'server.ts'), 'utf8');
const doctorSrc = readSource(join(projectRoot, 'bin/commands/doctor.ts'), 'utf8');

test('LM-001: serve.ts parseArgs includes --lan option', () => {
    assert.ok(serveSrc.includes("lan: { type: 'boolean'"),
        'serve.ts must have --lan boolean option in parseArgs');
});

test('LM-002: server.ts checks JAW_LAN_MODE env', () => {
    assert.ok(serverSrc.includes("JAW_LAN_MODE"),
        'server.ts must check JAW_LAN_MODE environment variable');
    assert.ok(serverSrc.includes("process.env.JAW_LAN_MODE === '1'"),
        'lanMode must compare JAW_LAN_MODE to string 1');
});

test('LM-003: lanAllowed() integrates lanMode || settings.network.lanBypass', () => {
    const idx = serverSrc.indexOf('const lanAllowed');
    assert.ok(idx >= 0, 'lanAllowed must be defined');
    const line = serverSrc.slice(idx, idx + 150);
    assert.ok(line.includes('lanMode') && line.includes('settings.network?.lanBypass'),
        'lanAllowed must OR lanMode with settings.network.lanBypass');
});

test('LM-004: misconfiguration warning for lanBypass=true + bindHost=127.0.0.1', () => {
    assert.ok(serverSrc.includes('lanBypass is enabled but bindHost is 127.0.0.1'),
        'server.ts must warn about lanBypass + loopback mismatch');
    assert.ok(serverSrc.includes('cli-jaw serve --lan'),
        'warning must suggest --lan flag as fix');
});

test('LM-005: doctor.ts has Network section', () => {
    assert.ok(doctorSrc.includes('Network'),
        'doctor.ts must have Network section header');
    assert.ok(doctorSrc.includes('bindHost'),
        'doctor.ts must check bindHost');
    assert.ok(doctorSrc.includes('lanBypass'),
        'doctor.ts must check lanBypass');
    assert.ok(doctorSrc.includes('JAW_AUTH_TOKEN'),
        'doctor.ts must check auth token env');
    assert.ok(doctorSrc.includes('LAN devices cannot connect'),
        'doctor.ts must warn about misconfiguration');
});

test('LM-006: serve.ts passes JAW_LAN_MODE env to child process', () => {
    assert.ok(serveSrc.includes('JAW_LAN_MODE'),
        'serve.ts must pass JAW_LAN_MODE to child env');
});

test('LM-007: serve.ts shows LAN mode in console output', () => {
    assert.ok(serveSrc.includes('LAN mode'),
        'serve.ts must display LAN mode indicator');
});
