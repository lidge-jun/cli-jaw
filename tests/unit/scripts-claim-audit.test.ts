import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const claimAuditUrl = pathToFileURL(path.join(repoRoot, 'scripts', 'claim-audit.mjs')).href;

interface AuditReport {
    ok: boolean;
    scanned: string[];
    offending: Array<{ file: string; line: number; term: string; why: string; section: string }>;
}
interface ClaimAuditModule {
    auditClaims: (opts: { repoRoot: string }) => AuditReport;
    formatClaimAuditReport: (r: AuditReport) => string;
}

function makeTmpRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-jaw-claim-audit-'));
    fs.mkdirSync(path.join(dir, 'structure'), { recursive: true });
    return dir;
}

describe('claim-audit (cli-jaw mirror)', () => {
    it('passes on a clean local-only README', async () => {
        const dir = makeTmpRepo();
        try {
            fs.writeFileSync(path.join(dir, 'README.md'), '# cli-jaw\n\nLocal multi-CLI agent runtime.\n');
            const mod = (await import(claimAuditUrl)) as ClaimAuditModule;
            const r = mod.auditClaims({ repoRoot: dir });
            assert.equal(r.ok, true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('flags hosted/cloud claim in a ready section', async () => {
        const dir = makeTmpRepo();
        try {
            fs.writeFileSync(
                path.join(dir, 'README.md'),
                '# cli-jaw\n\n## Ready\n\nWe ship a hosted browser runtime today.\n',
            );
            const mod = (await import(claimAuditUrl)) as ClaimAuditModule;
            const r = mod.auditClaims({ repoRoot: dir });
            assert.equal(r.ok, false);
            assert.ok(r.offending.some((o) => o.term === 'hosted browser'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not flag forbidden terms inside an Experimental section', async () => {
        const dir = makeTmpRepo();
        try {
            fs.writeFileSync(
                path.join(dir, 'README.md'),
                '# cli-jaw\n\n## Experimental / Deferred\n\nremote CDP, hosted browser, stealth — all deferred.\n',
            );
            const mod = (await import(claimAuditUrl)) as ClaimAuditModule;
            const r = mod.auditClaims({ repoRoot: dir });
            assert.equal(r.ok, true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not flag negation lines like "no CAPTCHA bypass"', async () => {
        const dir = makeTmpRepo();
        try {
            fs.writeFileSync(
                path.join(dir, 'README.md'),
                '# cli-jaw\n\n## Ready\n\n- no stealth, no CAPTCHA bypass\n- no Cloudflare bypass\n',
            );
            const mod = (await import(claimAuditUrl)) as ClaimAuditModule;
            const r = mod.auditClaims({ repoRoot: dir });
            assert.equal(r.ok, true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
