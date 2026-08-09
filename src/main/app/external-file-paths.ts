import { normalizeExternalFilePath } from '@main/core/fs/external-file-access';

/** Extract file arguments from a packaged Electron launch or second instance. */
export function extractExternalFilePaths(argv: readonly string[]): string[] {
  const separator = argv.indexOf('--');
  const candidates = separator >= 0 ? argv.slice(separator + 1) : argv.slice(1);
  const paths: string[] = [];

  for (const candidate of candidates) {
    const filePath = normalizeExternalFilePath(candidate);
    if (!filePath || paths.includes(filePath)) continue;
    paths.push(filePath);
  }

  return paths;
}
