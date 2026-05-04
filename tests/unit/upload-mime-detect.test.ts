import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { detectMimeFromBuffer, IMAGE_MIMES, AUDIO_MIMES } from '../../lib/mime-detect.ts';
import { saveUpload } from '../../lib/upload.ts';

function makeUploadsDir(): string {
    return mkdtempSync(join(tmpdir(), 'jaw-upload-test-'));
}

// ── detectMimeFromBuffer ──

test('detects PNG magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    assert.equal(detectMimeFromBuffer(buf), 'image/png');
});

test('detects JPEG magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(detectMimeFromBuffer(buf), 'image/jpeg');
});

test('detects GIF89a magic bytes', () => {
    const buf = Buffer.from('GIF89a\x00\x00\x00\x00\x00\x00', 'ascii');
    assert.equal(detectMimeFromBuffer(buf), 'image/gif');
});

test('detects WebP magic bytes', () => {
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(100, 4);
    buf.write('WEBP', 8, 'ascii');
    assert.equal(detectMimeFromBuffer(buf), 'image/webp');
});

test('detects OGG magic bytes', () => {
    const buf = Buffer.from('OggS\x00\x02\x00\x00', 'ascii');
    assert.equal(detectMimeFromBuffer(buf), 'audio/ogg');
});

test('detects WebM (EBML) magic bytes', () => {
    const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
    assert.equal(detectMimeFromBuffer(buf), 'audio/webm');
});

test('detects MP3 ID3 magic bytes', () => {
    const buf = Buffer.from('ID3\x04\x00\x00\x00\x00', 'ascii');
    assert.equal(detectMimeFromBuffer(buf), 'audio/mpeg');
});

test('detects WAV magic bytes', () => {
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(100, 4);
    buf.write('WAVE', 8, 'ascii');
    assert.equal(detectMimeFromBuffer(buf), 'audio/wav');
});

test('detects PDF magic bytes', () => {
    const buf = Buffer.from('%PDF-1.7\n', 'ascii');
    assert.equal(detectMimeFromBuffer(buf), 'application/pdf');
});

test('returns null for unknown content', () => {
    const buf = Buffer.from('Hello, world! This is plain text.');
    assert.equal(detectMimeFromBuffer(buf), null);
});

test('returns null for empty buffer', () => {
    assert.equal(detectMimeFromBuffer(Buffer.alloc(0)), null);
});

test('returns null for very short buffer', () => {
    assert.equal(detectMimeFromBuffer(Buffer.from([0x00, 0x01])), null);
});

// ── saveUpload with allowedMimes ──

test('saveUpload rejects non-image when allowedMimes is IMAGE_MIMES', () => {
    const dir = makeUploadsDir();
    const pdfBuf = Buffer.from('%PDF-1.7 fake pdf content padding here');
    assert.throws(
        () => saveUpload(dir, pdfBuf, 'document.pdf', { allowedMimes: IMAGE_MIMES }),
        (err: Error) => err.message.includes('upload_mime_rejected'),
    );
});

test('saveUpload rejects unrecognized content when allowedMimes set', () => {
    const dir = makeUploadsDir();
    const textBuf = Buffer.from('just plain text content here!!!!');
    assert.throws(
        () => saveUpload(dir, textBuf, 'file.txt', { allowedMimes: IMAGE_MIMES }),
        (err: Error) => err.message.includes('upload_mime_rejected'),
    );
});

test('saveUpload accepts PNG when allowedMimes is IMAGE_MIMES', () => {
    const dir = makeUploadsDir();
    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(100).fill(0)]);
    const filePath = saveUpload(dir, pngBuf, 'photo.png', { allowedMimes: IMAGE_MIMES });
    assert.ok(filePath.endsWith('.png'));
});

test('saveUpload corrects extension when MIME detected', () => {
    const dir = makeUploadsDir();
    const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
    const filePath = saveUpload(dir, jpegBuf, 'image.png');
    assert.ok(filePath.endsWith('.jpg'), `Expected .jpg extension but got ${extname(filePath)}`);
});

test('saveUpload keeps original extension for unknown content', () => {
    const dir = makeUploadsDir();
    const textBuf = Buffer.from('just plain text content here!!!! pad');
    const filePath = saveUpload(dir, textBuf, 'notes.txt');
    assert.ok(filePath.endsWith('.txt'));
});

test('saveUpload writes file without allowedMimes', () => {
    const dir = makeUploadsDir();
    const pdfBuf = Buffer.from('%PDF-1.7 fake pdf content with padding');
    const filePath = saveUpload(dir, pdfBuf, 'document.pdf');
    assert.ok(filePath.endsWith('.pdf'));
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
});
