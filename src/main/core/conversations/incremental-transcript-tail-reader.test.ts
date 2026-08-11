import { appendFileSync } from 'node:fs';
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IncrementalTranscriptTailReader } from './incremental-transcript-tail-reader';

const tempDirectories: string[] = [];

async function createTranscript(contents: string | Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yoda-transcript-tail-'));
  tempDirectories.push(directory);
  const filePath = join(directory, 'rollout.jsonl');
  await writeFile(filePath, contents);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('IncrementalTranscriptTailReader', () => {
  it('counts every non-empty line while retaining only the latest 500', async () => {
    const sourceLines = Array.from({ length: 620 }, (_, index) => `line-${index + 1}`);
    const filePath = await createTranscript(`\n${sourceLines.join('\n\n')}\n`);
    const reader = new IncrementalTranscriptTailReader(500, { chunkBytes: 37 });

    const snapshot = await reader.read(filePath);

    expect(snapshot.totalLines).toBe(620);
    expect(snapshot.lines).toEqual(sourceLines.slice(120));
  });

  it('reads only bytes appended after the cached file size', async () => {
    const initial = 'first\n';
    const appended = 'second\n';
    const filePath = await createTranscript(initial);
    const reads: Array<{ position: number; length: number }> = [];
    const reader = new IncrementalTranscriptTailReader(500, {
      chunkBytes: 1_024,
      onRead: (_path, position, length) => reads.push({ position, length }),
    });
    await reader.read(filePath);
    reads.length = 0;

    await appendFile(filePath, appended);
    const snapshot = await reader.read(filePath);

    expect(reads).toEqual([{ position: Buffer.byteLength(initial), length: appended.length }]);
    expect(snapshot).toEqual({ totalLines: 2, lines: ['first', 'second'] });
  });

  it('catches up once when the file grows during an active read', async () => {
    const initial = 'first\n';
    const filePath = await createTranscript(initial);
    const positions: number[] = [];
    let appended = false;
    const reader = new IncrementalTranscriptTailReader(500, {
      chunkBytes: 1_024,
      onRead: (_path, position) => {
        positions.push(position);
        if (appended) return;
        appended = true;
        appendFileSync(filePath, 'second\n');
      },
    });

    await expect(reader.read(filePath)).resolves.toEqual({
      totalLines: 2,
      lines: ['first', 'second'],
    });
    expect(positions).toEqual([0, Buffer.byteLength(initial)]);
  });

  it('materializes a partial final line without double-counting it when newline arrives', async () => {
    const filePath = await createTranscript('alpha\npar');
    const reader = new IncrementalTranscriptTailReader(500, { chunkBytes: 3 });

    await expect(reader.read(filePath)).resolves.toEqual({
      totalLines: 2,
      lines: ['alpha', 'par'],
    });

    await appendFile(filePath, 'tial\nbeta');
    await expect(reader.read(filePath)).resolves.toEqual({
      totalLines: 3,
      lines: ['alpha', 'partial', 'beta'],
    });

    await appendFile(filePath, '\n');
    await expect(reader.read(filePath)).resolves.toEqual({
      totalLines: 3,
      lines: ['alpha', 'partial', 'beta'],
    });
  });

  it('rebuilds state after truncation and same-path replacement', async () => {
    const filePath = await createTranscript('old-one\nold-two\nold-three\n');
    const reader = new IncrementalTranscriptTailReader(500, { chunkBytes: 5 });
    await reader.read(filePath);

    await writeFile(filePath, 'new\n');
    await expect(reader.read(filePath)).resolves.toEqual({ totalLines: 1, lines: ['new'] });

    const replacementPath = join(filePath, '..', 'replacement.jsonl');
    await writeFile(replacementPath, 'replacement\nsecond\n');
    await rename(replacementPath, filePath);
    await expect(reader.read(filePath)).resolves.toEqual({
      totalLines: 2,
      lines: ['replacement', 'second'],
    });
  });

  it('preserves UTF-8 characters split across both chunks and appends', async () => {
    const encoded = Buffer.from('你\n', 'utf8');
    const filePath = await createTranscript(encoded.subarray(0, 2));
    const reader = new IncrementalTranscriptTailReader(500, { chunkBytes: 1 });

    await expect(reader.read(filePath)).resolves.toEqual({ totalLines: 0, lines: [] });
    await appendFile(filePath, encoded.subarray(2));
    await expect(reader.read(filePath)).resolves.toEqual({ totalLines: 1, lines: ['你'] });
  });

  it('single-flights concurrent reads for the same path', async () => {
    const filePath = await createTranscript('single-flight\n');
    let readCount = 0;
    const reader = new IncrementalTranscriptTailReader(500, {
      chunkBytes: 1_024,
      onRead: () => {
        readCount += 1;
      },
    });

    const snapshots = await Promise.all([
      reader.read(filePath),
      reader.read(filePath),
      reader.read(filePath),
    ]);

    expect(readCount).toBe(1);
    expect(snapshots).toEqual([
      { totalLines: 1, lines: ['single-flight'] },
      { totalLines: 1, lines: ['single-flight'] },
      { totalLines: 1, lines: ['single-flight'] },
    ]);
  });

  it('evicts the least-recently-used path when the cache reaches its bound', async () => {
    const firstPath = await createTranscript('first\n');
    const secondPath = await createTranscript('second\n');
    const thirdPath = await createTranscript('third\n');
    const firstPathReads: number[] = [];
    const reader = new IncrementalTranscriptTailReader(500, {
      chunkBytes: 1_024,
      maxCacheEntries: 2,
      onRead: (filePath, position) => {
        if (filePath === firstPath) firstPathReads.push(position);
      },
    });
    await reader.read(firstPath);
    await reader.read(secondPath);
    await reader.read(thirdPath);
    firstPathReads.length = 0;

    await appendFile(firstPath, 'appended\n');
    await reader.read(firstPath);

    expect(firstPathReads[0]).toBe(0);
  });
});
