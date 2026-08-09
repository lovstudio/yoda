import { describe, expect, it } from 'vitest';
import { parseMobileExternalFileUrl } from '../../apps/mobile/src/external-file-input';

describe('mobile external file input', () => {
  it('recognizes an iOS image Open In URL and decodes its display name', () => {
    expect(
      parseMobileExternalFileUrl('file:///private/var/mobile/Inbox/design%20draft.png')
    ).toEqual({
      kind: 'image',
      name: 'design draft.png',
      uri: 'file:///private/var/mobile/Inbox/design%20draft.png',
    });
  });

  it('recognizes text documents and Android content URIs', () => {
    expect(parseMobileExternalFileUrl('content://downloads/my-notes.md')).toMatchObject({
      kind: 'text',
      name: 'my-notes.md',
    });
  });

  it('keeps unsupported local files visible for a user-facing error', () => {
    expect(parseMobileExternalFileUrl('file:///private/var/mobile/Inbox/report.pdf')).toEqual({
      kind: 'unsupported',
      name: 'report.pdf',
      uri: 'file:///private/var/mobile/Inbox/report.pdf',
    });
  });

  it('ignores pairing, web, and malformed URLs', () => {
    expect(parseMobileExternalFileUrl('yodamobile://connect?token=secret')).toBeNull();
    expect(parseMobileExternalFileUrl('https://example.com/image.png')).toBeNull();
    expect(parseMobileExternalFileUrl('file:///tmp/%E0%A4%A')).toMatchObject({
      kind: 'unsupported',
      name: '%E0%A4%A',
    });
  });
});
