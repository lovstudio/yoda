import { observer } from 'mobx-react-lite';
import { WorkspacePromptPopover } from '@renderer/app/workspace-prompt-popover';
import { appState } from '@renderer/lib/stores/app-state';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';
import { useRuntimeBarSession } from '../session-context';

/** Prompt principles for the session's runtime, plus a way into the library. */
export const RuntimeBarPromptItem = observer(function RuntimeBarPromptItem() {
  const { runtimeId, activeProjectId } = useRuntimeBarSession();
  if (!runtimeId) return null;
  return (
    <WorkspacePromptPopover
      runtimeId={runtimeId}
      projectId={activeProjectId}
      triggerClassName={RUNTIME_BAR_ACTION_CLASS}
      triggerLabelClassName={RUNTIME_BAR_ACTION_LABEL_CLASS}
      onOpenLibrary={() => appState.navigation.navigate('library', { section: 'prompts' })}
    />
  );
});
