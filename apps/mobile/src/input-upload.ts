import { discardInputAttachment, uploadInputImage, type MobileConnection } from './api-client';

const MOBILE_INPUT_UPLOAD_CONCURRENCY = 3;

export type MobileImageDraft = {
  id: string;
  base64: string;
  height: number;
  mimeType: 'image/jpeg';
  name: string;
  sizeBytes: number;
  uri: string;
  width: number;
};

export type MobileInputUploadProgress = {
  completedImages: number;
  totalImages: number;
  uploadedBytes: number;
  totalBytes: number;
};

export async function uploadMobileInputImages(
  connection: MobileConnection,
  images: MobileImageDraft[],
  onProgress?: (progress: MobileInputUploadProgress) => void
): Promise<string[]> {
  if (images.length === 0) return [];

  const totalBytes = images.reduce((total, image) => total + image.sizeBytes, 0);
  const uploadedBytes = images.map(() => 0);
  const attachmentIds: Array<string | undefined> = images.map(() => undefined);
  let completedImages = 0;
  let firstError: unknown;
  let nextImageIndex = 0;

  const reportProgress = () => {
    onProgress?.({
      completedImages,
      totalImages: images.length,
      uploadedBytes: uploadedBytes.reduce((total, value) => total + value, 0),
      totalBytes,
    });
  };

  reportProgress();

  const uploadNext = async () => {
    while (firstError === undefined) {
      const imageIndex = nextImageIndex;
      nextImageIndex += 1;
      const image = images[imageIndex];
      if (!image) return;

      try {
        const attachment = await uploadInputImage(connection, image, (progress) => {
          uploadedBytes[imageIndex] = Math.min(progress.receivedBytes, progress.totalBytes);
          reportProgress();
        });
        attachmentIds[imageIndex] = attachment.id;
        uploadedBytes[imageIndex] = image.sizeBytes;
        completedImages += 1;
        reportProgress();
      } catch (error) {
        firstError ??= error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MOBILE_INPUT_UPLOAD_CONCURRENCY, images.length) }, uploadNext)
  );

  if (firstError !== undefined) {
    await Promise.all(
      attachmentIds.map((attachmentId) =>
        attachmentId
          ? discardInputAttachment(connection, attachmentId).catch(() => undefined)
          : undefined
      )
    );
    throw firstError;
  }

  return attachmentIds.map((attachmentId) => {
    if (!attachmentId) throw new Error('An image upload did not return an attachment.');
    return attachmentId;
  });
}
