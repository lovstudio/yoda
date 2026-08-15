import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import { PermissionModeSelect } from '@renderer/features/tasks/components/permission-mode-select';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Textarea } from '@renderer/lib/ui/textarea';

export type InitialConversationState = {
  runtime: RuntimeId | null;
  setRuntime: (provider: RuntimeId | null) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
};

export function useInitialConversationState(connectionId?: string): InitialConversationState {
  const { runtimeId, setRuntimeOverride } = useEffectiveRuntime(connectionId);
  const [prompt, setPrompt] = useState('');
  return { runtime: runtimeId, setRuntime: setRuntimeOverride, prompt, setPrompt };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  connectionId?: string;
}

export function InitialConversationField({ state, connectionId }: InitialConversationFieldProps) {
  const { t } = useTranslation();

  return (
    <>
      <Field>
        <FieldLabel>{t('tasks.create.initialConversation')}</FieldLabel>
        <div className="flex flex-col border border-border rounded-md">
          <AgentSelector
            value={state.runtime}
            onChange={(provider) => state.setRuntime(provider)}
            connectionId={connectionId}
            className="rounded-none border-0 border-b"
          />
          <Textarea
            placeholder={t('tasks.create.initialPromptPlaceholder')}
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            className="min-h-24 resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:border-0"
          />
        </div>
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{t('tasks.create.permissionMode')}</FieldLabel>
          <PermissionModeSelect runtimeId={state.runtime} />
        </div>
      </Field>
    </>
  );
}
