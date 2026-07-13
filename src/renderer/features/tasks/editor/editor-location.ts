import type * as monacoNS from 'monaco-editor';
import type { FileRevealTarget } from '@renderer/features/tasks/tabs/file-tab-store';

export interface PendingEditorRevealSource {
  readonly pendingReveal: FileRevealTarget | null;
  consumePendingReveal(): FileRevealTarget | null;
}

export type RevealEditorLocationOptions = {
  focus?: boolean;
};

export function revealEditorLocation(
  editor: monacoNS.editor.IStandaloneCodeEditor,
  target: FileRevealTarget,
  options: RevealEditorLocationOptions = {}
): boolean {
  const model = editor.getModel();
  if (!model) return false;

  const lineNumber = Math.min(target.lineNumber, model.getLineCount());
  const column = Math.min(target.column, model.getLineMaxColumn(lineNumber));
  const position = { lineNumber, column };

  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  if (options.focus !== false) editor.focus();
  return true;
}

export function applyPendingEditorReveal(
  editor: monacoNS.editor.IStandaloneCodeEditor,
  source: PendingEditorRevealSource,
  options?: RevealEditorLocationOptions
): boolean {
  const target = source.pendingReveal;
  if (!target || !revealEditorLocation(editor, target, options)) return false;
  source.consumePendingReveal();
  return true;
}
