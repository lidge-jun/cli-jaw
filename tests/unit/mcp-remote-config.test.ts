import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSource } from './source-normalize.js';
import { toClaudeMcp, toCodexToml, toOpenCodeMcp } from '../../lib/mcp/format-converters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const unifiedConfigSrc = readSource(join(__dirname, '../../lib/mcp/unified-config.ts'), 'utf8');
const mcpInstallSrc = readSource(join(__dirname, '../../lib/mcp/mcp-install.ts'), 'utf8');
const postinstallSrc = readSource(join(__dirname, '../../bin/postinstall.ts'), 'utf8');

test('MCP-REMOTE-001: default Context7 MCP config uses remote HTTP URL', () => {
    const defaultBlock = unifiedConfigSrc.slice(
        unifiedConfigSrc.indexOf('const DEFAULT_MCP_SERVERS'),
        unifiedConfigSrc.indexOf('// ─── Load / Save unified config'),
    );

    assert.ok(defaultBlock.includes("type: 'http'"), 'Context7 default should be an HTTP MCP server');
    assert.ok(defaultBlock.includes("url: 'https://mcp.context7.com/mcp'"), 'Context7 default should use the remote endpoint');
    assert.ok(!defaultBlock.includes('@upstash/context7-mcp'), 'Context7 default should not spawn the local npm package');
});

test('MCP-REMOTE-002: remote MCP servers are emitted in each supported CLI format', () => {
    const config = {
        servers: {
            context7: {
                type: 'http',
                url: 'https://mcp.context7.com/mcp',
            },
        },
    };

    assert.deepEqual(toClaudeMcp(config), {
        mcpServers: {
            context7: {
                type: 'http',
                url: 'https://mcp.context7.com/mcp',
            },
        },
    });
    assert.match(toCodexToml(config), /\[mcp_servers\.context7\]\nurl = "https:\/\/mcp\.context7\.com\/mcp"/);
    assert.deepEqual(toOpenCodeMcp(config), {
        context7: {
            type: 'remote',
            url: 'https://mcp.context7.com/mcp',
            enabled: true,
        },
    });
});

test('MCP-REMOTE-003: postinstall skips local installs for URL-based MCP servers', () => {
    assert.ok(mcpInstallSrc.includes('srv.url'), 'shared MCP installer should detect URL-based servers');
    assert.ok(mcpInstallSrc.includes("reason: 'remote url'"), 'shared MCP installer should skip remote servers');

    const postinstallMcpBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function installMcpServers'));
    assert.ok(postinstallMcpBlock.includes('server.url'), 'postinstall MCP installer should inspect unified server URL');
    assert.ok(postinstallMcpBlock.includes('remote URL, no local install needed'), 'postinstall should not install remote Context7 locally');
});
