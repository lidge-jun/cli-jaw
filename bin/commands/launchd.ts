/**
 * cli-jaw launchd — macOS LaunchAgent 관리
 * Usage:
 *   jaw launchd              — plist 확인 → 없으면 생성 → 시작 (원스텝)
 *   jaw launchd --port 3458  — 커스텀 포트로 등록
 *   jaw launchd unset        — plist 제거 + 해제
 *   jaw launchd status       — 현재 상태 확인
 *   jaw launchd cleanup      — legacy plist 정리
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { JAW_HOME } from '../../src/core/config.js';
import { instanceId, getNodePath, getJawPath, buildServicePath } from '../../src/core/instance.js';
import { generateLaunchdPlist } from '../../src/core/launchd-plist.js';
import { findLegacyCliJawLabels } from '../../src/core/launchd-cleanup.js';
import { cuaAppInstalled } from '../../src/core/tcc.js';

// parseArgs is safe here — launchd is a leaf command (no subcommands to absorb)
const { values: launchdOpts, positionals: launchdPos } = parseArgs({
    args: process.argv.slice(3),
    options: { port: { type: 'string', default: '3457' } },
    strict: false,
    allowPositionals: true,
});
const PORT = launchdOpts.port as string;

// unknown flag guard (strict:false absorbs unknowns silently)
const knownKeys = new Set(['port']);
for (const key of Object.keys(launchdOpts)) {
    if (!knownKeys.has(key)) {
        console.error(`❌ Unknown option: --${key}`);
        console.error('   Usage: jaw launchd [--port PORT] [status|unset|cleanup]');
        process.exit(1);
    }
}

const INSTANCE = instanceId();
const LABEL = `com.cli-jaw.${INSTANCE}`;
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = join(JAW_HOME, 'logs');
const USER_ID = typeof process.getuid === 'function' ? process.getuid() : Number(process.env.UID || 0);
const GUI_DOMAIN = `gui/${USER_ID}`;


function generatePlist(): string {
    const nodePath = getNodePath();
    const jawPath = getJawPath();
    const servicePath = buildServicePath(process.env.PATH || '', [join(homedir(), '.local', 'bin')]);
    execSync(`mkdir -p "${LOG_DIR}"`);

    return generateLaunchdPlist({
        label: LABEL,
        port: PORT,
        nodePath,
        jawPath,
        jawHome: JAW_HOME,
        logDir: LOG_DIR,
        servicePath,
    });
}

function scanLegacyLabels(): string[] {
    const dir = join(homedir(), 'Library', 'LaunchAgents');
    if (!existsSync(dir)) return [];
    try {
        return findLegacyCliJawLabels(readdirSync(dir), LABEL);
    } catch {
        return [];
    }
}

function isLoaded(): boolean {
    try {
        execSync(`launchctl print ${GUI_DOMAIN}/${LABEL}`, { stdio: 'pipe' });
        return true;
    } catch { return false; }
}

const sub = launchdPos[0];

switch (sub) {
    case 'unset': {
        if (!existsSync(PLIST_PATH)) {
            console.log('⚠️  launchd에 등록되어 있지 않습니다');
            break;
        }
        try { execSync(`launchctl bootout ${GUI_DOMAIN}/${LABEL}`, { stdio: 'pipe' }); } catch { /* ok */ }
        unlinkSync(PLIST_PATH);
        console.log('✅ jaw serve 자동 실행 해제 완료');
        break;
    }
    case 'status': {
        if (!existsSync(PLIST_PATH)) {
            console.log('⚠️  jaw serve가 launchd에 등록되어 있지 않습니다');
            console.log('   등록: jaw launchd');
            break;
        }
        try {
            const out = execSync(`launchctl print ${GUI_DOMAIN}/${LABEL}`, { encoding: 'utf8' });
            const pidMatch = out.match(/pid = (\d+)/);
            const pid = pidMatch ? `running (PID ${pidMatch[1]})` : 'loaded';
            const ptMatch = out.match(/process type\s*=\s*(\w+)/i);
            const processType = ptMatch ? ptMatch[1] : '(unknown)';
            console.log(`🦈 jaw serve — ${pid}`);
            console.log(`   instance:    ${INSTANCE}`);
            console.log(`   port:        ${PORT}`);
            console.log(`   plist:       ${PLIST_PATH}`);
            console.log(`   log:         ${LOG_DIR}/jaw-serve.log`);
            console.log(`   domain:      ${GUI_DOMAIN}`);
            console.log(`   ProcessType: ${processType}`);
            console.log(`   Codex CUA:   ${cuaAppInstalled() ? '✅ 설치됨' : '❌ 없음 (jaw doctor --tcc --fix)'}`);
            const legacy = scanLegacyLabels();
            if (legacy.length > 0) {
                console.log(`   ⚠️  legacy plist ${legacy.length}개 — 정리: jaw launchd cleanup`);
            }
        } catch {
            console.log('🦈 jaw serve — not loaded');
            console.log(`   plist: ${PLIST_PATH} (exists but not loaded)`);
        }
        break;
    }
    case 'cleanup': {
        const legacy = scanLegacyLabels();
        if (legacy.length === 0) {
            console.log('✅ legacy launchd 잔존물 없음');
            break;
        }
        console.log(`🧹 legacy plist ${legacy.length}개 정리:`);
        for (const label of legacy) {
            const legacyPlist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
            try { execSync(`launchctl bootout ${GUI_DOMAIN}/${label}`, { stdio: 'pipe' }); } catch { /* ok */ }
            try {
                unlinkSync(legacyPlist);
                console.log(`  ✓ removed: ${label}`);
            } catch (e: any) {
                console.log(`  ✗ failed: ${label} (${e?.message || 'unknown'})`);
            }
        }
        break;
    }
    default: {
        // 원스텝: 확인 → 생성 → 시작
        console.log('🦈 jaw launchd setup\n');

        // 0. legacy plist 경고 (삭제는 cleanup에서)
        const legacy = scanLegacyLabels();
        if (legacy.length > 0) {
            console.log(`⚠️  legacy plist ${legacy.length}개 발견 — 정리 권장: jaw launchd cleanup`);
            for (const l of legacy) console.log(`    - ${l}`);
            console.log('');
        }

        // 1. plist 생성 (무조건 재생성)
        const plist = generatePlist();
        writeFileSync(PLIST_PATH, plist);
        console.log(`✅ plist 저장: ${PLIST_PATH}`);

        // 2. bootout 무조건 선수행 (에러 무시 — 미등록 상태는 정상)
        try {
            execSync(`launchctl bootout ${GUI_DOMAIN}/${LABEL}`, { stdio: 'pipe' });
            console.log('🧹 기존 등록 해제');
        } catch { /* 미등록이면 정상 */ }

        // 3. bootstrap + error 5 (I/O error) 복구
        try {
            execSync(`launchctl bootstrap ${GUI_DOMAIN} "${PLIST_PATH}"`, { stdio: 'pipe' });
            console.log('✅ launchd 등록 + 시작 완료\n');
        } catch (e: any) {
            const stderr = (e?.stderr?.toString?.() || e?.message || '');
            const isBusy = /Bootstrap failed:\s*5/i.test(stderr)
                || /already (bootstrapped|loaded)/i.test(stderr);
            if (isBusy) {
                console.log('⚠️  기존 등록 충돌 — 강제 해제 후 재시도');
                try { execSync(`launchctl disable ${GUI_DOMAIN}/${LABEL}`, { stdio: 'pipe' }); } catch { /* ok */ }
                try { execSync(`launchctl bootout ${GUI_DOMAIN}/${LABEL}`, { stdio: 'pipe' }); } catch { /* ok */ }
                try { execSync('sleep 0.5'); } catch { /* ok */ }
                try { execSync(`launchctl enable ${GUI_DOMAIN}/${LABEL}`, { stdio: 'pipe' }); } catch { /* ok */ }
                execSync(`launchctl bootstrap ${GUI_DOMAIN} "${PLIST_PATH}"`, { stdio: 'inherit' });
                console.log('✅ 재시도 성공\n');
            } else {
                throw e;
            }
        }

        // 4. 상태 확인
        setTimeout(() => {
            if (isLoaded()) {
                console.log('🦈 jaw serve가 백그라운드에서 실행 중입니다');
                console.log(`   instance: ${INSTANCE}`);
                console.log(`   http://localhost:${PORT}`);
                console.log(`   로그: ${LOG_DIR}/jaw-serve.log`);
                if (process.platform === 'darwin' && !cuaAppInstalled()) {
                    console.log('\n   ⚠️  Codex CUA 앱 미설치 — jaw doctor --tcc --fix');
                }
                console.log('\n   해제: jaw launchd unset');
            } else {
                console.log('⚠️  시작되지 않았습니다. 로그를 확인하세요:');
                console.log(`   cat ${LOG_DIR}/jaw-serve.err`);
            }
        }, 1000);
        break;
    }
}
