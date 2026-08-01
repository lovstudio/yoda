import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES } from '@shared/mobile-api';
import {
  MobileInputAttachmentError,
  MobileInputAttachmentStore,
} from './mobile-input-attachment-store';

describe('MobileInputAttachmentStore', () => {
  let directory: string;
  let store: MobileInputAttachmentStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yoda-mobile-attachments-'));
    store = new MobileInputAttachmentStore(directory);
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(directory, { force: true, recursive: true });
  });

  it('stores chunked images and resolves only completed uploads', async () => {
    const content = Buffer.from('mobile image bytes');
    const created = await store.create({
      kind: 'image',
      mimeType: 'image/jpeg',
      name: '../camera\0.jpg',
      sizeBytes: content.byteLength,
    });

    await expect(
      store.append(created.attachmentId, {
        offset: 0,
        dataBase64: content.toString('base64'),
      })
    ).resolves.toEqual({
      attachmentId: created.attachmentId,
      receivedBytes: content.byteLength,
    });
    await expect(store.complete(created.attachmentId)).resolves.toMatchObject({
      id: created.attachmentId,
      kind: 'image',
      mimeType: 'image/jpeg',
      name: 'camera .jpg',
      sizeBytes: content.byteLength,
    });

    const [resolved] = store.resolve([created.attachmentId]);
    expect(resolved?.filePath).toMatch(new RegExp(`${created.attachmentId}\\.jpg$`));
    await expect(fs.readFile(resolved!.filePath)).resolves.toEqual(content);
  });

  it('rejects out-of-order and oversized chunks', async () => {
    const created = await store.create({
      kind: 'image',
      mimeType: 'image/png',
      name: 'screen.png',
      sizeBytes: MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES + 1,
    });

    await expect(
      store.append(created.attachmentId, { offset: 1, dataBase64: 'eA==' })
    ).rejects.toMatchObject({ code: 'attachment_offset_mismatch', status: 409 });
    await expect(
      store.append(created.attachmentId, {
        offset: 0,
        dataBase64: Buffer.alloc(MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES + 1).toString('base64'),
      })
    ).rejects.toMatchObject({ code: 'attachment_chunk_too_large', status: 413 });
  });

  it('keeps incomplete uploads unavailable and discards their files', async () => {
    const created = await store.create({
      kind: 'image',
      mimeType: 'image/webp',
      name: 'reference.webp',
      sizeBytes: 4,
    });
    await store.append(created.attachmentId, { offset: 0, dataBase64: 'eA==' });

    expect(() => store.resolve([created.attachmentId])).toThrowError(MobileInputAttachmentError);
    await expect(store.complete(created.attachmentId)).rejects.toMatchObject({
      code: 'attachment_incomplete',
    });

    const filesBefore = await fs.readdir(directory);
    expect(filesBefore).toHaveLength(1);
    await store.discard(created.attachmentId);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });
});
