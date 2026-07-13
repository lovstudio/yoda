import type * as monaco from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import { MonacoModelRegistry } from './monaco-model-registry';

vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

type TestBufferEntry = {
  type: 'buffer';
  model: monaco.editor.ITextModel;
  viewState: monaco.editor.ICodeEditorViewState | null;
  refs: number;
  projectId: string;
  workspaceId: string;
  filePath: string;
  language: string;
};

function seedBuffer(
  registry: MonacoModelRegistry,
  uri: string,
  model: monaco.editor.ITextModel,
  viewState: monaco.editor.ICodeEditorViewState | null
): void {
  const modelMap = Reflect.get(registry, 'modelMap') as Map<string, TestBufferEntry>;
  modelMap.set(uri, {
    type: 'buffer',
    model,
    viewState,
    refs: 1,
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    filePath: 'src/main.ts',
    language: 'typescript',
  });
}

describe('MonacoModelRegistry.attach', () => {
  it('does not restore stale view state when the target model is already attached', () => {
    const registry = new MonacoModelRegistry();
    const model = {} as monaco.editor.ITextModel;
    const viewState = {} as monaco.editor.ICodeEditorViewState;
    seedBuffer(registry, 'file:///src/main.ts', model, viewState);
    const editor = {
      getModel: vi.fn(() => model),
      setModel: vi.fn(),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(),
    } as unknown as monaco.editor.IStandaloneCodeEditor;

    registry.attach(editor, 'file:///src/main.ts', 'file:///src/main.ts');

    expect(editor.setModel).not.toHaveBeenCalled();
    expect(editor.restoreViewState).not.toHaveBeenCalled();
  });

  it('attaches a different model and restores its view state', () => {
    const registry = new MonacoModelRegistry();
    const model = {} as monaco.editor.ITextModel;
    const viewState = {} as monaco.editor.ICodeEditorViewState;
    seedBuffer(registry, 'file:///src/main.ts', model, viewState);
    const editor = {
      getModel: vi.fn(() => null),
      setModel: vi.fn(),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(),
    } as unknown as monaco.editor.IStandaloneCodeEditor;

    registry.attach(editor, 'file:///src/main.ts');

    expect(editor.setModel).toHaveBeenCalledWith(model);
    expect(editor.restoreViewState).toHaveBeenCalledWith(viewState);
  });
});
