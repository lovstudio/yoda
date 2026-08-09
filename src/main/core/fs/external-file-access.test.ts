import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeExternalFilePath,
  clearExternalFileAccessForTests,
  readExternalFile,
  readExternalImage,
  writeExternalFile,
} from './external-file-access';

describe('external file access', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    clearExternalFileAccessForTests();
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads and writes an explicitly opened text file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoda-external-file-'));
    tempRoots.push(root);
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'before');
    authorizeExternalFilePath(filePath);

    expect(await readExternalFile(filePath)).toMatchObject({
      content: 'before',
      truncated: false,
      totalSize: 6,
    });
    await writeExternalFile(filePath, 'after');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('after');
  });

  it('returns a data URL for an explicitly opened image', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoda-external-image-'));
    tempRoots.push(root);
    const filePath = path.join(root, 'pixel.png');
    fs.writeFileSync(filePath, Buffer.from('89504e470d0a1a0a', 'hex'));
    authorizeExternalFilePath(filePath);

    await expect(readExternalImage(filePath)).resolves.toMatchObject({
      success: true,
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
  });

  it('does not read a path that has not been opened', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoda-external-guard-'));
    tempRoots.push(root);
    const filePath = path.join(root, 'private.txt');
    fs.writeFileSync(filePath, 'private');

    await expect(readExternalFile(filePath)).rejects.toThrow('not opened through Yoda');
  });
});
