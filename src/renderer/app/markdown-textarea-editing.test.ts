import { describe, expect, it } from 'vitest';
import { applyMarkdownEnterEdit, applyMarkdownTabEdit } from './markdown-textarea-editing';

describe('markdown textarea editing helpers', () => {
  it('inserts markdown indentation at the caret for plain text', () => {
    expect(applyMarkdownTabEdit('plaintext', { start: 5, end: 5 }, 'indent')).toEqual({
      value: 'plain  text',
      selection: { start: 7, end: 7 },
    });
  });

  it('indents the current list item from the line start', () => {
    expect(applyMarkdownTabEdit('- item', { start: 6, end: 6 }, 'indent')).toEqual({
      value: '  - item',
      selection: { start: 8, end: 8 },
    });
  });

  it('indents the current task list item from the line start', () => {
    expect(applyMarkdownTabEdit('- [ ] item', { start: 10, end: 10 }, 'indent')).toEqual({
      value: '  - [ ] item',
      selection: { start: 12, end: 12 },
    });
  });

  it('indents every selected line', () => {
    expect(applyMarkdownTabEdit('- a\n- b', { start: 0, end: 7 }, 'indent')).toEqual({
      value: '  - a\n  - b',
      selection: { start: 0, end: 11 },
    });
  });

  it('does not indent a trailing unselected line', () => {
    expect(applyMarkdownTabEdit('- a\n- b\n- c', { start: 0, end: 8 }, 'indent')).toEqual({
      value: '  - a\n  - b\n- c',
      selection: { start: 0, end: 12 },
    });
  });

  it('outdents selected lines with spaces or tabs', () => {
    expect(applyMarkdownTabEdit('  - a\n\t- b\n- c', { start: 0, end: 13 }, 'outdent')).toEqual({
      value: '- a\n- b\n- c',
      selection: { start: 0, end: 10 },
    });
  });

  it('outdents the current line and keeps the caret aligned', () => {
    expect(applyMarkdownTabEdit('  - item', { start: 4, end: 4 }, 'outdent')).toEqual({
      value: '- item',
      selection: { start: 2, end: 2 },
    });
  });

  it('keeps a later selected block aligned while outdenting', () => {
    expect(applyMarkdownTabEdit('  - a\n  - b\n  - c', { start: 8, end: 17 }, 'outdent')).toEqual({
      value: '  - a\n- b\n- c',
      selection: { start: 6, end: 13 },
    });
  });

  it('continues a bullet list on enter', () => {
    expect(applyMarkdownEnterEdit('- item', { start: 6, end: 6 })).toEqual({
      value: '- item\n- ',
      selection: { start: 9, end: 9 },
    });
  });

  it('continues an indented bullet list with the same marker', () => {
    expect(applyMarkdownEnterEdit('  * item', { start: 8, end: 8 })).toEqual({
      value: '  * item\n  * ',
      selection: { start: 13, end: 13 },
    });
  });

  it('increments ordered list markers on enter', () => {
    expect(applyMarkdownEnterEdit('9. item', { start: 7, end: 7 })).toEqual({
      value: '9. item\n10. ',
      selection: { start: 12, end: 12 },
    });
  });

  it('continues checked task list items as unchecked', () => {
    expect(applyMarkdownEnterEdit('- [x] done', { start: 10, end: 10 })).toEqual({
      value: '- [x] done\n- [ ] ',
      selection: { start: 17, end: 17 },
    });
  });

  it('exits an empty list item on enter', () => {
    expect(applyMarkdownEnterEdit('- ', { start: 2, end: 2 })).toEqual({
      value: '',
      selection: { start: 0, end: 0 },
    });
  });

  it('splits a list item at the caret', () => {
    expect(applyMarkdownEnterEdit('- foobar', { start: 5, end: 5 })).toEqual({
      value: '- foo\n- bar',
      selection: { start: 8, end: 8 },
    });
  });

  it('does not handle non-list enter edits', () => {
    expect(applyMarkdownEnterEdit('plain text', { start: 10, end: 10 })).toBe(null);
  });
});
