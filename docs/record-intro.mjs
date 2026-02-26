// Capture intro animation frames via CDP → ffmpeg → mp4
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const FRAMES_DIR = '/tmp/clijaw-frames';
const OUTPUT = path.resolve('docs/clijaw-intro.mp4');
const FPS = 30;
const DURATION_SEC = 2.5;
const TOTAL_FRAMES = Math.floor(FPS * DURATION_SEC);
const FRAME_MS = 1000 / FPS;

// Clean/create frames dir
if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

async function main() {
    console.log('Connecting to Chrome on CDP port 9240...');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9240');
    const context = await browser.newContext({
        viewport: { width: 1662, height: 1080 },
    });
    const page = await context.newPage();

    // Navigate — animation starts on load
    console.log('Navigating to intro page...');
    await page.goto('http://localhost:8899/clijaw-intro.html', { waitUntil: 'domcontentloaded' });

    // Small settle delay for first paint
    await page.waitForTimeout(50);

    console.log(`Capturing ${TOTAL_FRAMES} frames at ${FPS}fps...`);
    for (let i = 0; i < TOTAL_FRAMES; i++) {
        const framePath = path.join(FRAMES_DIR, `frame_${String(i).padStart(4, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png' });
        await page.waitForTimeout(FRAME_MS);
        if (i % 15 === 0) process.stdout.write(`\r  ${i}/${TOTAL_FRAMES}`);
    }
    console.log(`\r  ${TOTAL_FRAMES}/${TOTAL_FRAMES} ✓`);

    await page.close();
    await context.close();
    browser.close();

    // Assemble with ffmpeg
    console.log('Assembling with ffmpeg...');
    execSync(
        `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame_%04d.png" ` +
        `-c:v libx264 -pix_fmt yuv420p -crf 18 -preset fast "${OUTPUT}"`,
        { stdio: 'inherit' }
    );
    console.log(`✅ Intro saved: ${OUTPUT}`);

    // Cleanup
    fs.rmSync(FRAMES_DIR, { recursive: true });
}

main().catch(e => { console.error(e); process.exit(1); });
