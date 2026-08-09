import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Prompt } from '@shared/prompt-library';
import { Badge } from '@renderer/lib/ui/badge';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';

export function PromptInjectionControls({
  prompts,
  isPromptEnabled,
  onPromptEnabledChange,
  disabled = false,
  empty,
  className,
  variant = 'default',
}: {
  prompts: Prompt[];
  isPromptEnabled: (prompt: Prompt) => boolean;
  onPromptEnabledChange: (prompt: Prompt, enabled: boolean) => void;
  disabled?: boolean;
  empty?: ReactNode;
  className?: string;
  variant?: 'default' | 'compact';
}) {
  const { t } = useTranslation();
  const compact = variant === 'compact';
  const orderedPrompts = prompts
    .slice()
    .sort((left, right) => left.injectionOrder - right.injectionOrder);

  if (orderedPrompts.length === 0) return empty ?? null;

  return (
    <div
      data-slot="prompt-injection-controls"
      data-variant={variant}
      className={cn(compact ? 'block' : 'grid gap-2', className)}
    >
      <div
        className={cn(
          'divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-background',
          compact && 'rounded-none border-x-0 border-b-0 border-border/50'
        )}
      >
        {orderedPrompts.map((prompt) => (
          <div
            key={prompt.id}
            data-slot="prompt-injection-row"
            className={cn(
              'flex min-w-0 items-center justify-between gap-3',
              compact ? 'min-h-8 px-3 py-1.5' : 'px-2.5 py-2'
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'min-w-0 truncate text-foreground',
                  compact ? 'text-[11px]' : 'text-xs'
                )}
              >
                {prompt.title || t('home.promptPrincipleUnnamed')}
              </span>
              {!compact && prompt.tags.length > 0 ? (
                <span className="flex min-w-0 flex-wrap gap-1" data-slot="prompt-tags">
                  {prompt.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="max-w-28 truncate">
                      {tag}
                    </Badge>
                  ))}
                </span>
              ) : null}
              {!compact && prompt.content ? (
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
    </div>
  );
}
