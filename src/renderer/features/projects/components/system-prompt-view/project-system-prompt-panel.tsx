import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import { ProjectPromptSection } from '@renderer/features/prompt-library/project-prompt-section';
import { PromptRuntimeSelector } from '@renderer/features/prompt-library/prompt-system-section';

/** Project-scoped home for every instruction layer appended around a runtime's built-in prompt. */
export function ProjectSystemPromptPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [runtimeId, setRuntimeId] = useState<RuntimeId | null>(null);

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <header>
          <h1 className="text-lg font-medium text-foreground">
            {t('projects.systemPrompt.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-foreground-muted">
            {t('projects.systemPrompt.description')}
          </p>
        </header>

        <PromptRuntimeSelector runtimeId={runtimeId} onRuntimeIdChange={setRuntimeId} />
        <ProjectPromptSection
          projectId={projectId}
          runtimeId={runtimeId}
          showProjectSelector={false}
          showGlobalPrompts
        />
      </div>
    </div>
  );
}
