import type * as monacoNS from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import { FileTabStore, type FileRevealTarget } from '@renderer/features/tasks/tabs/file-tab-store';
import {
  applyPendingEditorReveal,
  revealEditorLocation,
  type PendingEditorRevealSource,
} from './editor-location';

function makeEditor(options: { lineCount?: number; maxColumn?: number; hasModel?: boolean } = {}) {
  const lineCount = options.lineCount ?? 20;
  const maxColumn = options.maxColumn ?? 12;
  const model =
    options.hasModel === false
      ? null
      : {
          getLineCount: vi.fn(() => lineCount),
          getLineMaxColumn: vi.fn(() => maxColumn),
        };
  const editor = {
    getModel: vi.fn(() => model),
    setPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    focus: vi.fn(),
  } as unknown as monacoNS.editor.IStandaloneCodeEditor;
  return { editor, model };
}

function revealTarget(lineNumber: number, column: number): FileRevealTarget {
  return { requestId: 1, lineNumber, column };
}

describe('editor location reveal', () => {
  it('clamps the target to the model and focuses it', () => {
    const { editor } = makeEditor({ lineCount: 20, maxColumn: 12 });

    expect(revealEditorLocation(editor, revealTarget(31, 18))).toBe(true);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 20, column: 12 });
    expect(editor.revealPositionInCenter).toHaveBeenCalledWith({ lineNumber: 20, column: 12 });
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it('keeps a pending target until an editor model is ready', () => {
    const target = revealTarget(31, 4);
    const source: PendingEditorRevealSource = {
      pendingReveal: target,
      consumePendingReveal: vi.fn(() => target),
    };
    const { editor } = makeEditor({ hasModel: false });

    expect(applyPendingEditorReveal(editor, source)).toBe(false);
    expect(source.consumePendingReveal).not.toHaveBeenCalled();
  });

  it('can reveal a side-pane location without stealing focus', () => {
    const { editor } = makeEditor();

    expect(revealEditorLocation(editor, revealTarget(8, 3), { focus: false })).toBe(true);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 8, column: 3 });
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it('consumes a pending target after applying it', () => {
    const target = revealTarget(8, 3);
    const source: PendingEditorRevealSource = {
      pendingReveal: target,
      consumePendingReveal: vi.fn(() => target),
    };
    const { editor } = makeEditor();

    expect(applyPendingEditorReveal(editor, source)).toBe(true);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 8, column: 3 });
    expect(source.consumePendingReveal).toHaveBeenCalledOnce();
  });

  it('applies and clears a real file tab location request', () => {
    const source = new FileTabStore('src/main.ts', false);
    source.revealLocation(31);
    const { editor } = makeEditor({ lineCount: 100, maxColumn: 20 });

    expect(applyPendingEditorReveal(editor, source)).toBe(true);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 31, column: 1 });
    expect(source.pendingReveal).toBeNull();
  });
});
