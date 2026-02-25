#!/usr/bin/env npx tsx
/**
 * cli-claw — Phase 9.1
 * CLI entrypoint with subcommand routing.
 * No external dependencies — Node built-in only.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const command = process.argv[2];

function printHelp() {
    console.log(`
  🦞 cli-claw v${pkg.version}

  Usage:  cli-claw <command> [options]

  Commands:
    serve      서버 시작 (포그라운드)
    init       초기 설정 마법사
    doctor     설치/설정 진단
    chat       터미널 채팅 (REPL)
    employee   직원 관리 (reset)
    reset      전체 초기화 (MCP/스킬/직원/세션)
    mcp        MCP 서버 관리 (install/sync/list)
    skill      스킬 관리 (install/remove/info)
    status     서버 상태 확인

  Options:
    --help     도움말 표시
    --version  버전 표시

  Examples:
    cli-claw serve --port 3457
    cli-claw init
    cli-claw doctor --json
    cli-claw chat --raw
`);
}

switch (command) {
    case 'serve':
        await import('./commands/serve.ts');
        break;
    case 'init':
        await import('./commands/init.ts');
        break;
    case 'doctor':
        await import('./commands/doctor.ts');
        break;
    case 'chat':
        await import('./commands/chat.ts');
        break;
    case 'employee':
        await import('./commands/employee.ts');
        break;
    case 'reset':
        await import('./commands/reset.ts');
        break;
    case 'mcp':
        await import('./commands/mcp.ts');
        break;
    case 'skill':
        await import('./commands/skill.ts');
        break;
    case 'status':
        await import('./commands/status.ts');
        break;
    case 'browser':
        await import('./commands/browser.ts');
        break;
    case 'memory':
        await import('./commands/memory.ts');
        break;
    case '--version':
    case '-v':
        console.log(`cli-claw v${pkg.version}`);
        break;
    case '--help':
    case '-h':
    case undefined:
        printHelp();
        break;
    default:
        console.error(`  ❌ Unknown command: ${command}\n`);
        printHelp();
        process.exitCode = 1;
        break;
}
