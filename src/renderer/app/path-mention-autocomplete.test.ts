import { describe, expect, it } from 'vitest';
import {
  applyPathCompletion,
  buildPathCompletionItems,
  findActivePathMention,
  splitPathMentionQuery,
} from './path-mention-autocomplete';

describe('path mention autocomplete helpers', () => {
  it('finds an active @ path mention at the caret', () => {
    expect(findActivePathMention('fix @src/app', 'fix @src/app'.length)).toEqual({
      start: 4,
      end: 12,
      query: 'src/app',
    });
  });

  it('does not treat email-like text as a path mention', () => {
    expect(findActivePathMention('contact me@example.com', 'contact me@example.com'.length)).toBe(
      null
    );
  });

  it('splits relative path queries', () => {
    expect(splitPathMentionQuery('src/ren')).toEqual({
      pathKind: 'relative',
      directoryPath: 'src',
      namePrefix: 'ren',
      preserveDotSlash: false,
    });
  });

  it('splits absolute path queries', () => {
    expect(splitPathMentionQuery('/Users/mark/project/src/ren')).toEqual({
      pathKind: 'absolute',
      directoryPath: '/Users/mark/project/src',
      namePrefix: 'ren',
      preserveDotSlash: false,
    });
  });

  it('splits home path queries without exposing the expanded home directory', () => {
    expect(splitPathMentionQuery('~/Documents/pro')).toEqual({
      pathKind: 'home',
      directoryPath: 'Documents',
      namePrefix: 'pro',
      preserveDotSlash: false,
    });
    expect(splitPathMentionQuery('~')).toEqual({
      pathKind: 'home',
      directoryPath: '.',
      namePrefix: '',
      preserveDotSlash: false,
    });
  });

  it('preserves leading dot-slash relative completions', () => {
    const parts = splitPathMentionQuery('./src/ren');
    expect(
      buildPathCompletionItems([{ path: 'src/renderer', type: 'dir' }], parts)[0]?.insertText
    ).toBe('./src/renderer/');
  });

  it('preserves the home prefix in completion text', () => {
    const parts = splitPathMentionQuery('~/Doc');
    expect(
      buildPathCompletionItems([{ path: 'Documents', type: 'dir' }], parts)[0]?.insertText
    ).toBe('~/Documents/');
  });

  it('filters and sorts completion items by prefix and type', () => {
    const parts = splitPathMentionQuery('src/r');
    expect(
      buildPathCompletionItems(
        [
          { path: 'src/readme.md', type: 'file' },
          { path: 'src/renderer', type: 'dir' },
          { path: 'src/main', type: 'dir' },
          { path: 'src/.hidden', type: 'dir' },
        ],
        parts
      ).map((item) => item.insertText)
    ).toEqual(['src/renderer/', 'src/readme.md']);
  });

  it('replaces only the active mention query', () => {
    const value = 'inspect @src/ren please';
    const mention = findActivePathMention(value, 'inspect @src/ren'.length);
    if (!mention) throw new Error('Expected an active mention');

    expect(applyPathCompletion(value, mention, 'src/renderer/')).toEqual({
      value: 'inspect @src/renderer/ please',
      caret: 'inspect @src/renderer/'.length,
    });
  });
});
