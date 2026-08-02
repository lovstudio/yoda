import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  discardInputAttachment as discardInputAttachmentFunction,
  uploadInputImage as uploadInputImageFunction,
} from '../../apps/mobile/src/api-client';
import { uploadMobileInputImages, type MobileImageDraft } from '../../apps/mobile/src/input-upload';

type UploadInputImage = typeof uploadInputImageFunction;
type DiscardInputAttachment = typeof discardInputAttachmentFunction;

const apiMocks = vi.hoisted(() => ({
  discardInputAttachment: vi.fn<DiscardInputAttachment>(),
  uploadInputImage: vi.fn<UploadInputImage>(),
}));

vi.mock('../../apps/mobile/src/api-client', () => apiMocks);

const connection = { baseUrl: 'http://127.0.0.1:3879', token: 'dev-token' };

function image(index: number): MobileImageDraft {
  return {
    id: `image-${index}`,
    base64: 'YWJj',
    height: 100,
    mimeType: 'image/jpeg',
    name: `image-${index}.jpg`,
    sizeBytes: 3,
    uri: `file://image-${index}.jpg`,
    width: 100,
  };
}

describe('mobile multi-image uploads', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips upload progress for a text-only request', async () => {
    const progress = vi.fn();

    await expect(uploadMobileInputImages(connection, [], progress)).resolves.toEqual([]);

    expect(apiMocks.uploadInputImage).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('uploads at most three images concurrently and preserves selection order', async () => {
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    apiMocks.uploadInputImage.mockImplementation(async (_connection, input, onProgress) => {
      activeUploads += 1;
      maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      onProgress?.({ receivedBytes: 3, totalBytes: 3 });
      activeUploads -= 1;
      return {
        id: `attachment-${input.name}`,
        kind: 'image',
        mimeType: input.mimeType,
        name: input.name,
        sizeBytes: 3,
      };
    });

    const progress = vi.fn();
    const result = await uploadMobileInputImages(
      connection,
      [image(0), image(1), image(2), image(3), image(4)],
      progress
    );

    expect(maximumActiveUploads).toBe(3);
    expect(result).toEqual([
      'attachment-image-0.jpg',
      'attachment-image-1.jpg',
      'attachment-image-2.jpg',
      'attachment-image-3.jpg',
      'attachment-image-4.jpg',
    ]);
    expect(progress).toHaveBeenLastCalledWith({
      completedImages: 5,
      totalImages: 5,
      uploadedBytes: 15,
      totalBytes: 15,
    });
  });

  it('waits for active uploads and discards completed attachments after a failure', async () => {
    apiMocks.uploadInputImage.mockImplementation(async (_connection, input) => {
      if (input.name === 'image-1.jpg') throw new Error('upload failed');
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        id: `attachment-${input.name}`,
        kind: 'image',
        mimeType: input.mimeType,
        name: input.name,
        sizeBytes: 3,
      };
    });
    apiMocks.discardInputAttachment.mockResolvedValue({ ok: true });

    await expect(
      uploadMobileInputImages(connection, [image(0), image(1), image(2), image(3)])
    ).rejects.toThrow('upload failed');

    expect(apiMocks.uploadInputImage).toHaveBeenCalledTimes(3);
    expect(apiMocks.discardInputAttachment.mock.calls.map((call) => call[1]).sort()).toEqual([
      'attachment-image-0.jpg',
      'attachment-image-2.jpg',
    ]);
  });
});
