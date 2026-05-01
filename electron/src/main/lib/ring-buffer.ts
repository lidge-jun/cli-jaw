export class RingBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly cap: number = 1024 * 1024) {}

  append(chunk: Buffer | string): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    this.chunks.push(buf);
    this.size += buf.length;
    while (this.size > this.cap && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const overflow = this.size - this.cap;
      if (head.length <= overflow) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(overflow);
        this.size -= overflow;
      }
    }
  }

  read(): string {
    return Buffer.concat(this.chunks, this.size).toString('utf8');
  }

  clear(): void {
    this.chunks = [];
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}
