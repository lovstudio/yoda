import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES,
  MOBILE_INPUT_ATTACHMENT_MAX_BYTES,
  type MobileInputAttachment,
  type MobileInputAttachmentChunkRequest,
  type MobileInputAttachmentCreateRequest,
} from '@shared/mobile-api';

const MAX_PENDING_ATTACHMENT_UPLOADS = 32;
const STORED_ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

type AttachmentRecord = MobileInputAttachment & {
  complete: boolean;
  createdAt: number;
  filePath: string;
  receivedBytes: number;
  writing: boolean;
};

export class MobileInputAttachmentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function displayName(value: string): string {
  const normalized = path.basename(value.replace(/[\r\n\0]/g, ' ').trim()).slice(0, 120);
  return normalized || 'mobile-image.jpg';
}

function normalizeCreateRequest(
  input: MobileInputAttachmentCreateRequest
): MobileInputAttachmentCreateRequest & { extension: string } {
  if (!input || typeof input !== 'object') {
    throw new MobileInputAttachmentError(
      400,
      'invalid_attachment',
      'Attachment metadata must be an object.'
    );
  }
  const value = input as Partial<MobileInputAttachmentCreateRequest>;
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim().toLowerCase() : '';
  const extension = IMAGE_EXTENSIONS[mimeType];
  if (value.kind !== 'image' || !extension) {
    throw new MobileInputAttachmentError(
      415,
      'unsupported_attachment',
      'Only JPEG, PNG, WebP, GIF, HEIC, and HEIF images are supported.'
    );
  }
  if (!Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes ?? 0) <= 0) {
    throw new MobileInputAttachmentError(
      400,
      'invalid_attachment_size',
      'Attachment size must be a positive integer.'
    );
  }
  if ((value.sizeBytes ?? 0) > MOBILE_INPUT_ATTACHMENT_MAX_BYTES) {
    throw new MobileInputAttachmentError(
      413,
      'attachment_too_large',
      `Each image must be ${MOBILE_INPUT_ATTACHMENT_MAX_BYTES} bytes or smaller.`
    );
  }
  return {
    kind: value.kind,
    mimeType,
    name: displayName(typeof value.name === 'string' ? value.name : ''),
    sizeBytes: value.sizeBytes!,
    extension,
  };
}

function decodeChunk(dataBase64: string): Buffer {
  if (
    !dataBase64 ||
    dataBase64.length > Math.ceil((MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES * 4) / 3) + 4
  ) {
    throw new MobileInputAttachmentError(
      413,
      'attachment_chunk_too_large',
      'Attachment chunk exceeds the mobile upload limit.'
    );
  }
  if (!BASE64_RE.test(dataBase64)) {
    throw new MobileInputAttachmentError(
      400,
      'invalid_attachment_chunk',
      'Attachment chunk must be valid base64.'
    );
  }
  const chunk = Buffer.from(dataBase64, 'base64');
  if (chunk.byteLength === 0 || chunk.byteLength > MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES) {
    throw new MobileInputAttachmentError(
      413,
      'attachment_chunk_too_large',
      'Attachment chunk exceeds the mobile upload limit.'
    );
  }
  return chunk;
}

export class MobileInputAttachmentStore {
  private readonly records = new Map<string, AttachmentRecord>();

  constructor(
    private readonly rootDirectory: string,
    private readonly now: () => number = Date.now
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.rootDirectory, { recursive: true });
    const entries = await fs.readdir(this.rootDirectory, { withFileTypes: true });
    const cutoff = this.now() - STORED_ATTACHMENT_MAX_AGE_MS;
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return;
        const filePath = path.join(this.rootDirectory, entry.name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.rm(filePath, { force: true });
      })
    );
  }

  async create(input: MobileInputAttachmentCreateRequest): Promise<{
    attachmentId: string;
    chunkSizeBytes: number;
  }> {
    const pendingUploadCount = [...this.records.values()].filter(
      (attachment) => !attachment.complete
    ).length;
    if (pendingUploadCount >= MAX_PENDING_ATTACHMENT_UPLOADS) {
      throw new MobileInputAttachmentError(
        429,
        'too_many_pending_attachments',
        'Too many image uploads are pending. Finish or retry the current request.'
      );
    }
    const normalized = normalizeCreateRequest(input);
    const id = randomUUID();
    const filePath = path.join(this.rootDirectory, `${id}${normalized.extension}`);
    await fs.mkdir(this.rootDirectory, { recursive: true });
    await fs.writeFile(filePath, Buffer.alloc(0), { flag: 'wx' });
    this.records.set(id, {
      id,
      kind: normalized.kind,
      name: normalized.name,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.sizeBytes,
      complete: false,
      createdAt: this.now(),
      filePath,
      receivedBytes: 0,
      writing: false,
    });
    return { attachmentId: id, chunkSizeBytes: MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES };
  }

  async append(
    attachmentId: string,
    input: MobileInputAttachmentChunkRequest
  ): Promise<{ attachmentId: string; receivedBytes: number }> {
    const record = this.requireRecord(attachmentId);
    if (record.complete) {
      throw new MobileInputAttachmentError(
        409,
        'attachment_already_complete',
        'Attachment upload is already complete.'
      );
    }
    if (record.writing) {
      throw new MobileInputAttachmentError(
        409,
        'attachment_write_in_progress',
        'Wait for the current attachment chunk to finish uploading.'
      );
    }
    if (!input || typeof input !== 'object') {
      throw new MobileInputAttachmentError(
        400,
        'invalid_attachment_chunk',
        'Attachment chunk must be an object.'
      );
    }
    if (!Number.isSafeInteger(input.offset) || input.offset !== record.receivedBytes) {
      throw new MobileInputAttachmentError(
        409,
        'attachment_offset_mismatch',
        `Expected attachment offset ${record.receivedBytes}.`
      );
    }
    const chunk = decodeChunk(typeof input.dataBase64 === 'string' ? input.dataBase64 : '');
    if (record.receivedBytes + chunk.byteLength > record.sizeBytes) {
      throw new MobileInputAttachmentError(
        413,
        'attachment_size_mismatch',
        'Attachment data exceeds its declared size.'
      );
    }
    record.writing = true;
    try {
      await fs.appendFile(record.filePath, chunk);
      record.receivedBytes += chunk.byteLength;
    } finally {
      record.writing = false;
    }
    return { attachmentId, receivedBytes: record.receivedBytes };
  }

  async complete(attachmentId: string): Promise<MobileInputAttachment> {
    const record = this.requireRecord(attachmentId);
    if (record.receivedBytes !== record.sizeBytes) {
      throw new MobileInputAttachmentError(
        409,
        'attachment_incomplete',
        `Attachment has ${record.receivedBytes} of ${record.sizeBytes} bytes.`
      );
    }
    const stat = await fs.stat(record.filePath).catch(() => null);
    if (!stat || stat.size !== record.sizeBytes) {
      throw new MobileInputAttachmentError(
        409,
        'attachment_size_mismatch',
        'Stored attachment size does not match the upload.'
      );
    }
    record.complete = true;
    return this.publicAttachment(record);
  }

  resolve(attachmentIds: string[]): Array<MobileInputAttachment & { filePath: string }> {
    const uniqueIds = [...new Set(attachmentIds)];
    if (uniqueIds.length !== attachmentIds.length) {
      throw new MobileInputAttachmentError(
        400,
        'duplicate_attachment',
        'The same image cannot be attached more than once.'
      );
    }
    return uniqueIds.map((id) => {
      const record = this.requireRecord(id);
      if (!record.complete) {
        throw new MobileInputAttachmentError(
          409,
          'attachment_incomplete',
          'Finish uploading every image before sending the request.'
        );
      }
      return { ...this.publicAttachment(record), filePath: record.filePath };
    });
  }

  release(attachmentIds: string[]): void {
    for (const attachmentId of attachmentIds) this.records.delete(attachmentId);
  }

  async discard(attachmentId: string): Promise<void> {
    const record = this.records.get(attachmentId);
    if (!record) return;
    this.records.delete(attachmentId);
    await fs.rm(record.filePath, { force: true });
  }

  private requireRecord(attachmentId: string): AttachmentRecord {
    const record = this.records.get(attachmentId);
    if (!record) {
      throw new MobileInputAttachmentError(
        404,
        'attachment_not_found',
        'Mobile image upload was not found. Select the image again.'
      );
    }
    return record;
  }

  private publicAttachment(record: AttachmentRecord): MobileInputAttachment {
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
    };
  }
}
