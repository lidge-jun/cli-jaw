/**
 * TUI WebSocket message handler.
 */
import type WebSocket from 'ws';
import {
    startAssistantItem, appendToActiveAssistant,
    finalizeAssistant, appendStatusItem, clearEphemeralStatus,
} from '../../../src/cli/tui/transcript.js';
import { captureFileSet, diffFileSets, getDiffStat, getIdeCli, openDiffInIde } from '../../../src/ide/diff.js';
import { c, type TuiContext } from './types.js';
import { openPromptBlock, renderAssistantTurnStart } from './renderer.js';
import { dismissOverlay } from './overlays.js';

export function handleWsMessage(ctx: TuiContext, data: WebSocket.Data): void {
    const raw = data.toString();
    const ov = ctx.store.overlay;
    const transcript = ctx.store.transcript;
    try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
            case 'agent_chunk':
                if (ov.helpOpen || ov.paletteOpen) dismissOverlay(ctx);
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                    break;
                }
                clearEphemeralStatus(transcript);
                if (!ctx.streaming) {
                    ctx.streaming = true;
                    startAssistantItem(transcript);
                    renderAssistantTurnStart();
                }
                appendToActiveAssistant(transcript, msg.text || '');
                process.stdout.write((msg.text || '').replace(/\n/g, '\n  '));
                break;

            case 'agent_done':
                clearEphemeralStatus(transcript);
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                } else if (ctx.streaming) {
                    finalizeAssistant(transcript);
                    console.log('');
                } else if (msg.text) {
                    startAssistantItem(transcript);
                    appendToActiveAssistant(transcript, msg.text);
                    finalizeAssistant(transcript);
                    renderAssistantTurnStart();
                    console.log(msg.text.replace(/\n/g, '\n  '));
                }
                // IDE diff
                if (ctx.isGit && ctx.preFileSetQueue.length > 0) {
                    const preSet = ctx.preFileSetQueue.shift()!;
                    if (ctx.ideEnabled) {
                        const postSet = captureFileSet(ctx.chatCwd);
                        const changed = diffFileSets(preSet, postSet);
                        if (changed.length > 0) {
                            const stat = getDiffStat(ctx.chatCwd, changed);
                            console.log(`\n  ${c.cyan}\uD83D\uDCC2 ${changed.length}\uAC1C \uD30C\uC77C \uBCC0\uACBD\uB428${c.reset}`);
                            if (stat) console.log(`  ${stat}`);
                            else for (const f of changed.slice(0, 10)) console.log(`  ${c.dim}  \u25E6 ${f}${c.reset}`);
                            if (changed.length > 10) console.log(`  ${c.dim}  ... +${changed.length - 10}\uAC1C${c.reset}`);
                            if (ctx.idePopEnabled && ctx.detectedIde) {
                                console.log(`  ${c.dim}\u2192 ${getIdeCli(ctx.detectedIde)}\uC5D0\uC11C diff \uC5F4\uAE30${c.reset}`);
                                openDiffInIde(ctx.chatCwd, changed, ctx.detectedIde);
                            }
                        }
                    }
                }
                ctx.streaming = false;
                ctx.inputActive = true;
                openPromptBlock(ctx);
                break;

            case 'agent_status':
                if (msg.status === 'done') break;
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                } else if (msg.status === 'running') {
                    const name = msg.agentName || msg.agentId || 'agent';
                    appendStatusItem(transcript, `${name} working...`);
                    process.stdout.write(`\r  ${c.yellow}\u25CF${c.reset} ${c.dim}${name} working...${c.reset}          \r`);
                }
                break;

            case 'agent_tool':
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                } else if (msg.icon && msg.label) {
                    appendStatusItem(transcript, `${msg.icon} ${msg.label}`);
                    process.stdout.write(`\r  ${c.dim}${msg.icon} ${msg.label}${c.reset}          \r`);
                }
                break;

            case 'agent_fallback':
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                } else {
                    appendStatusItem(transcript, `${msg.from} \u2192 ${msg.to}`);
                    process.stdout.write(`\r  ${c.yellow}\u26A1${c.reset} ${c.dim}${msg.from} \u2192 ${msg.to}${c.reset}          \r`);
                }
                break;

            case 'queue_update':
                if (msg.pending > 0) {
                    appendStatusItem(transcript, `${msg.pending}\uAC1C \uB300\uAE30 \uC911`);
                    process.stdout.write(`\r  ${c.yellow}\u23F3 ${msg.pending}\uAC1C \uB300\uAE30 \uC911${c.reset}          \r`);
                }
                break;

            case 'new_message':
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                } else if (msg.source && msg.source !== 'cli') {
                    console.log(`\n  ${c.dim}[${msg.source}]${c.reset} ${(msg.content || '').slice(0, 60)}`);
                }
                break;

            default:
                if (ctx.isRaw) {
                    console.log(`  ${c.dim}${raw}${c.reset}`);
                }
                break;
        }
    } catch { /* ignore parse errors */ }
}
