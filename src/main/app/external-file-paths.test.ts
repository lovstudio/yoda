import { describe, expect, it } from 'vitest';
import { extractExternalFilePaths } from './external-file-paths';

describe('extractExternalFilePaths', () => {
  it('reads file paths from a packaged launch argv', () => {
    expect(
      extractExternalFilePaths([
        '/Applications/Yoda.app/Contents/MacOS/Yoda',
        '/tmp/design draft.png',
      ])
    ).toEqual(['/tmp/design draft.png']);
  });

  it('supports the argument separator and ignores non-file schemes', () => {
    expect(
      extractExternalFilePaths([
        '/Applications/Yoda.app/Contents/MacOS/Yoda',
        '--',
        'file:///tmp/photo%20one.png',
        'yoda://open?path=%2Ftmp%2Fignored.png',
        'file:///tmp/photo%20one.png',
      ])
    ).toEqual(['/tmp/photo one.png']);
  });

  it('ignores switches', () => {
    expect(
      extractExternalFilePaths(['/Applications/Yoda.app/Contents/MacOS/Yoda', '--hidden'])
    ).toEqual([]);
  });
});
