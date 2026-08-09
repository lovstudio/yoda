import { describe, expect, it } from 'vitest';
import {
  getProjectPathForNameRename,
  joinProjectPath,
  replaceProjectPathLeaf,
} from './project-path';

describe('joinProjectPath', () => {
  it('joins POSIX project paths', () => {
    expect(joinProjectPath('/Users/mark/yoda/', '/docs/feature.md')).toBe(
      '/Users/mark/yoda/docs/feature.md'
    );
  });

  it('preserves Windows separators for remote project paths', () => {
    expect(joinProjectPath('C:\\work\\yoda\\', 'docs/feature.md')).toBe(
      'C:\\work\\yoda\\docs\\feature.md'
    );
  });
});

describe('replaceProjectPathLeaf', () => {
  it('replaces a POSIX path leaf', () => {
    expect(replaceProjectPathLeaf('/Users/mark/projects/yoda', 'new-name')).toBe(
      '/Users/mark/projects/new-name'
    );
  });

  it('preserves Windows separators', () => {
    expect(replaceProjectPathLeaf('C:\\work\\yoda\\', 'new-name')).toBe('C:\\work\\new-name');
  });
});

describe('getProjectPathForNameRename', () => {
  it('returns a new path when the displayed name matches the current leaf', () => {
    expect(getProjectPathForNameRename('yoda', '/Users/mark/projects/yoda', 'new-name')).toBe(
      '/Users/mark/projects/new-name'
    );
  });

  it('leaves custom-name projects on their existing path', () => {
    expect(getProjectPathForNameRename('My Yoda', '/Users/mark/projects/yoda', 'new-name')).toBe(
      undefined
    );
  });

  it('does not turn an empty alias into a path rename', () => {
    expect(getProjectPathForNameRename('yoda', '/Users/mark/projects/yoda', null)).toBe(undefined);
  });
});
