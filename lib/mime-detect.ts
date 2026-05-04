export const MIME_TO_EXT: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'application/pdf': '.pdf',
};

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const AUDIO_MIMES = ['audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/wav'] as const;

export function detectMimeFromBuffer(buffer: Buffer): string | null {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.length >= 8
        && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
        && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
        return 'image/png';
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    // GIF87a / GIF89a
    if (buffer.length >= 6) {
        const gif = buffer.subarray(0, 6).toString('ascii');
        if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
    }
    // RIFF container: WebP or WAV
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF') {
        const sub = buffer.subarray(8, 12).toString('ascii');
        if (sub === 'WEBP') return 'image/webp';
        if (sub === 'WAVE') return 'audio/wav';
    }
    // OGG: 4F 67 67 53
    if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
    // WebM / Matroska (EBML header): 1A 45 DF A3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return 'audio/webm';
    }
    // MP3: ID3 tag or MPEG sync word
    if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
        return 'audio/mpeg';
    }
    // MP3 frame sync: require valid MPEG version (not reserved) and layer (not reserved)
    if (buffer[0] === 0xff && buffer[1] != null
        && (buffer[1] & 0xe0) === 0xe0
        && (buffer[1] & 0x18) !== 0x08
        && (buffer[1] & 0x06) !== 0x00) {
        return 'audio/mpeg';
    }
    // PDF: %PDF
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return 'application/pdf';
    }
    return null;
}
