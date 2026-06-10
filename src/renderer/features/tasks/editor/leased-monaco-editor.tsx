import { autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type * as monacoNS from 'monaco-editor';
import { useEffect, useRef, type ReactNode } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { registerActiveCodeEditor } from '@renderer/lib/editor/activeCodeEditor';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { codeEditorPool } from '@renderer/lib/monaco/monaco-code-pool';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
} from '@renderer/lib/monaco/monaco-config';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/lib/monaco/monaco-themes';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { useMonacoLease } from '@renderer/lib/monaco/use-monaco-lease';

interface LeasedMonacoEditorProps {
  /** Workspace-relative path of the file to edit. Remount (key) when it changes. */
  filePath: string;
  /** Optional floating overlay (e.g. a source/preview toggle). */
  overlay?: ReactNode;
}

/**
 * Self-contained Monaco editor that owns its own pool lease — separate from the
 * shared persistent Monaco bound to the active file tab. Used by the markdown
 * source mode and by the side pane, which both edit a file that is not (or not
 * necessarily) the active tab.
 */
export const LeasedMonacoEditor = observer(function LeasedMonacoEditor({
  filePath,
  overlay,
}: LeasedMonacoEditorProps) {
  const { taskView } = useProvisionedTask();
  const { editorView } = taskView;
  const { effectiveTheme, themeFingerprint } = useTheme();

  const leaseBox = useMonacoLease(codeEditorPool);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  const prevBufUriRef = useRef<string | undefined>(undefined);

  // Theme sync
  useEffect(() => {
    const m = codeEditorPool.getMonaco();
    if (m) defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    codeEditorPool.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme, themeFingerprint]);

  // Editor setup — fires when the lease arrives
  useEffect(
    () =>
      reaction(
        () => leaseBox.get(),
        (lease) => {
          editorRef.current = lease?.editor ?? null;
          if (!lease) return;

          lease.editor.updateOptions({ glyphMargin: false });
          configureMonacoEditor(lease.editor);

          const cleanupActive = registerActiveCodeEditor(lease.editor);
          lease.disposables.push({ dispose: cleanupActive });

          const monaco = codeEditorPool.getMonaco();
          if (monaco) {
            addMonacoKeyboardShortcuts(lease.editor, monaco as typeof monacoNS, {
              onSave: () => {
                if (filePath) void editorView.saveFile(filePath);
              },
              onSaveAll: () => {
                void editorView.saveAllFiles();
              },
            });
          }

          lease.disposables.push(
            lease.editor.onDidFocusEditorWidget(() => {
              taskView.setFocusedRegion('main');
            })
          );

          if (hostRef.current) {
            hostRef.current.appendChild(lease.container);
            lease.editor.layout();
          }
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Model attachment — re-evaluates when lease, filePath, or modelStatus changes
  useEffect(
    () =>
      autorun(() => {
        const lease = leaseBox.get();
        if (!lease) return;

        const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);
        const status = modelRegistry.modelStatus.get(bufferUri);
        if (status !== 'ready') return;

        modelRegistry.attach(lease.editor, bufferUri, prevBufUriRef.current);
        prevBufUriRef.current = bufferUri;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const setHost = (el: HTMLDivElement | null) => {
    hostRef.current = el;
    const lease = leaseBox.get();
    if (el && lease) {
      el.appendChild(lease.container);
      lease.editor.layout();
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={setHost} className="absolute inset-0" />
      {overlay}
    </div>
  );
});
