import { ChevronRight, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Prompt } from '@shared/prompt-library';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

type PromptEditDraft = {
  title: string;
  content: string;
};

type PromptEditHandler = (prompt: Prompt, draft: PromptEditDraft) => Promise<unknown> | unknown;

export function PromptInjectionControls({
  prompts,
  isPromptEnabled,
  onPromptEnabledChange,
  disabled = false,
  empty,
  className,
  variant = 'default',
  onPromptEdit,
}: {
  prompts: Prompt[];
  isPromptEnabled: (prompt: Prompt) => boolean;
  onPromptEnabledChange: (prompt: Prompt, enabled: boolean) => void;
  onPromptEdit?: PromptEditHandler;
  disabled?: boolean;
  empty?: ReactNode;
  className?: string;
  variant?: 'default' | 'compact';
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const compact = variant === 'compact';
  const orderedPrompts = prompts
    .slice()
    .filter((prompt) => !compact || isPromptEnabled(prompt))
    .sort((left, right) => left.injectionOrder - right.injectionOrder);
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PromptEditDraft | null>(null);
  const [savingPromptId, setSavingPromptId] = useState<string | null>(null);

  if (orderedPrompts.length === 0) return empty ?? null;

  const handleExpandedChange = (prompt: Prompt, open: boolean) => {
    if (!open) {
      setExpandedPromptId(null);
      setEditDraft(null);
      return;
    }
    setExpandedPromptId(prompt.id);
    setEditDraft({ title: prompt.title, content: prompt.content });
  };

  const handleSave = async (prompt: Prompt) => {
    if (!onPromptEdit || !editDraft) return;
    const draft = {
      title: editDraft.title.trim(),
      content: editDraft.content.trim(),
    };
    if (!draft.title || !draft.content) return;

    setSavingPromptId(prompt.id);
    try {
      await onPromptEdit(prompt, draft);
      setExpandedPromptId(null);
      setEditDraft(null);
    } catch (error) {
      toast({
        title: t('promptLibrary.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        debugInfo: error,
        variant: 'destructive',
      });
    } finally {
      setSavingPromptId(null);
    }
  };

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
        {orderedPrompts.map((prompt) => {
          const name = prompt.title || t('home.promptPrincipleUnnamed');
          const isOpen = expandedPromptId === prompt.id;
          const isSaving = savingPromptId === prompt.id;
          const row = (
            <div
              data-slot="prompt-injection-row"
              className={cn(
                'flex min-w-0 items-center justify-between gap-3',
                compact ? 'min-h-8 pr-3' : 'px-2.5 py-2'
              )}
            >
              {compact ? (
                <CollapsibleTrigger
                  className="group flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
                  aria-label={t('promptLibrary.injection.editPrompt', { name })}
                  title={t('promptLibrary.injection.editPrompt', { name })}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-foreground-muted transition-transform',
                      isOpen && 'rotate-90'
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate text-[11px] text-foreground">{name}</span>
                </CollapsibleTrigger>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-xs text-foreground">{name}</span>
                  {prompt.tags.length > 0 ? (
                    <span className="flex min-w-0 flex-wrap gap-1" data-slot="prompt-tags">
                      {prompt.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="max-w-28 truncate">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                  {prompt.content ? (
                    <InfoTooltip
                      label={name}
                      content={<span className="whitespace-pre-wrap">{prompt.content}</span>}
                    />
                  ) : null}
                </div>
              )}
              <Switch
                size="sm"
                checked={isPromptEnabled(prompt)}
                disabled={disabled || isSaving}
                onCheckedChange={(checked) => onPromptEnabledChange(prompt, checked)}
                aria-label={t('promptLibrary.injection.toggle', { name })}
              />
            </div>
          );

          if (!compact) return <div key={prompt.id}>{row}</div>;

          return (
            <Collapsible
              key={prompt.id}
              open={isOpen}
              onOpenChange={(open) => handleExpandedChange(prompt, open)}
              className="transition-colors data-[panel-open]:bg-background-1/40"
            >
              {row}
              <CollapsibleContent>
                {onPromptEdit && editDraft && isOpen ? (
                  <PromptInlineEditor
                    prompt={prompt}
                    draft={editDraft}
                    disabled={isSaving}
                    onChange={setEditDraft}
                    onCancel={() => handleExpandedChange(prompt, false)}
                    onSave={() => void handleSave(prompt)}
                  />
                ) : (
                  <div className="border-t border-border/50 bg-background px-3 py-2.5 pl-10">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground-muted">
                      {prompt.content}
                    </pre>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

function PromptInlineEditor({
  prompt,
  draft,
  disabled,
  onChange,
  onCancel,
  onSave,
}: {
  prompt: Prompt;
  draft: PromptEditDraft;
  disabled: boolean;
  onChange: (draft: PromptEditDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const canSave = Boolean(draft.title.trim() && draft.content.trim());

  return (
    <div
      data-slot="prompt-injection-editor"
      className="grid gap-2.5 border-t border-border/50 bg-background px-3 py-3 pl-10"
    >
      <label className="grid gap-1">
        <span className="text-[10px] text-foreground-muted">{t('promptLibrary.form.title')}</span>
        <Input
          value={draft.title}
          disabled={disabled}
          aria-label={t('promptLibrary.form.title')}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[10px] text-foreground-muted">{t('promptLibrary.form.content')}</span>
        <Textarea
          value={draft.content}
          disabled={disabled}
          readOnly={Boolean(prompt.source)}
          aria-label={t('promptLibrary.form.content')}
          onChange={(event) => onChange({ ...draft, content: event.target.value })}
          className="min-h-20 resize-y text-xs"
        />
        {prompt.source ? (
          <span className="text-[10px] leading-4 text-foreground-passive">
            {t('promptLibrary.source.readOnlyHint')}
          </span>
        ) : null}
      </label>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={disabled || !canSave}
          data-slot="prompt-injection-save"
          onClick={onSave}
        >
          {disabled ? <Loader2 className="size-3 animate-spin" /> : null}
          {disabled ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
