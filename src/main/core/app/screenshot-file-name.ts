export function createScreenshotFileName(
  suggestedName: string | undefined,
  now = new Date()
): string {
  const baseName =
    suggestedName
      ?.normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/-+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[-. ]+|[-. ]+$/g, '')
      .trim()
      .slice(0, 80) || 'latest-reply';
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${baseName}-${timestamp}.png`;
}
