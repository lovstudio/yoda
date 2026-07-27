import { Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Prompt } from '@shared/prompt-library';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import {
  getInjectionOrderedPromptGroups,
  getPromptGroupInjectionState,
  UNGROUPED_PROMPT_GROUP,
} from './prompt-groups';

export function PromptGroupInjectionToggle({
  groupName,
  prompts,
  isPromptEnabled,
  onEnabledChange,
  disabled = false,
  className,
}: {
  groupName: string;
  prompts: Prompt[];
  isPromptEnabled: (prompt: Prompt) => boolean;
  onEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const selection = getPromptGroupInjectionState(prompts, isPromptEnabled);
  const groupLabel =
    groupName === UNGROUPED_PROMPT_GROUP ? t('promptLibrary.groups.ungrouped') : groupName;

  return (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      <span className="text-[11px] tabular-nums text-foreground-passive">
        {t('promptLibrary.groups.enabledCount', {
          enabled: selection.enabledCount,
          count: selection.totalCount,
        })}
      </span>
      <Checkbox
        checked={selection.state === 'all'}
        indeterminate={selection.state === 'partial'}
        disabled={disabled || prompts.length === 0}
        onCheckedChange={() => onEnabledChange(selection.state !== 'all')}
        aria-label={t('promptLibrary.groups.toggleInjection', { name: groupLabel })}
        title={t('promptLibrary.groups.toggleInjection', { name: groupLabel })}
      />
    </div>
  );
}

export function PromptInjectionControls({
  prompts,
  isPromptEnabled,
  onPromptEnabledChange,
  onGroupEnabledChange,
  disabled = false,
  empty,
  className,
}: {
  prompts: Prompt[];
  isPromptEnabled: (prompt: Prompt) => boolean;
  onPromptEnabledChange: (prompt: Prompt, enabled: boolean) => void;
  onGroupEnabledChange: (groupName: string, prompts: Prompt[], enabled: boolean) => void;
  disabled?: boolean;
  empty?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const groups = getInjectionOrderedPromptGroups(prompts);

  if (groups.length === 0) return empty ?? null;

  return (
    <div data-slot="prompt-injection-controls" className={cn('grid gap-2', className)}>
      {groups.map((group) => {
        const groupLabel =
          group.name === UNGROUPED_PROMPT_GROUP ? t('promptLibrary.groups.ungrouped') : group.name;
        return (
          <section
            key={group.name || 'ungrouped'}
            data-slot="prompt-injection-group"
            className="overflow-hidden rounded-md border border-border/60 bg-background"
          >
            <div className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-background-1 px-2.5 py-2">
              <Folder className="size-3.5 shrink-0 text-foreground-muted" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {groupLabel}
              </span>
              <PromptGroupInjectionToggle
                groupName={group.name}
                prompts={group.prompts}
                isPromptEnabled={isPromptEnabled}
                disabled={disabled}
                onEnabledChange={(enabled) =>
                  onGroupEnabledChange(group.name, group.prompts, enabled)
                }
              />
            </div>
            <div className="divide-y divide-border/50">
              {group.prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  data-slot="prompt-injection-row"
                  className="flex min-w-0 items-center justify-between gap-3 px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-xs text-foreground">
                      {prompt.title || t('home.promptPrincipleUnnamed')}
                    </span>
                    {prompt.content ? (
                      <InfoTooltip
                        label={prompt.title || t('home.promptPrincipleUnnamed')}
                        content={<span className="whitespace-pre-wrap">{prompt.content}</span>}
                      />
                    ) : null}
                  </div>
                  <Switch
                    size="sm"
                    checked={isPromptEnabled(prompt)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onPromptEnabledChange(prompt, checked)}
                    aria-label={t('promptLibrary.injection.toggle', { name: prompt.title })}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
