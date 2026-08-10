import { Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { PromptPrinciple } from '@shared/project-settings';
import { isPromptBoundToScope } from '@shared/prompt-library';
import {
  effectiveGlobalEnabled,
  setGlobalOverride,
  setProjectItems,
} from '@renderer/features/projects/project-prompt-principles';
import { PromptInjectionControls } from '@renderer/features/prompt-library/prompt-injection-controls';
import { usePrompts } from '@renderer/features/prompt-library/use-prompts';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { FormState, FormUpdate } from '../project-settings-form-model';

type PromptPrinciplesSectionProps = {
  projectId: string;
  form: FormState;
  update: FormUpdate;
};

export const PromptPrinciplesSection = observer(function PromptPrinciplesSection({
  projectId,
  form,
  update,
}: PromptPrinciplesSectionProps) {
  const { t } = useTranslation();
  const { data: prompts } = usePrompts();
  const globalItems = (prompts ?? [])
    .filter((prompt) => isPromptBoundToScope(prompt, 'project', projectId))
    .slice()
    .sort((left, right) => left.injectionOrder - right.injectionOrder);
  const project = form.promptPrinciples;
  const items = project?.items ?? [];

  const patchItem = (id: string, patch: Partial<PromptPrinciple>) =>
    update(
      'promptPrinciples',
      setProjectItems(
        project,
        items.map((item) => (item.id === id ? { ...item, ...patch } : item))
      )
    );

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldTitle>{t('projects.settings.promptPrinciples.title')}</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            {t('projects.settings.promptPrinciples.description')}
          </FieldDescription>
        </div>

        <Field>
          <FieldTitle className="text-xs text-foreground-muted">
            {t('projects.settings.promptPrinciples.globalHeading')}
          </FieldTitle>
          {globalItems.length === 0 ? (
            <FieldDescription className="text-foreground-passive">
              {t('projects.settings.promptPrinciples.globalEmpty')}
            </FieldDescription>
          ) : (
            <PromptInjectionControls
              prompts={globalItems}
              isPromptEnabled={(prompt) => effectiveGlobalEnabled(project, prompt)}
              onPromptEnabledChange={(prompt, checked) =>
                update('promptPrinciples', setGlobalOverride(project, prompt, checked))
              }
            />
          )}
        </Field>

        <Field>
          <FieldTitle className="text-xs text-foreground-muted">
            {t('projects.settings.promptPrinciples.localHeading')}
          </FieldTitle>
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-2"
              >
                <div className="flex items-center gap-2">
                  <Switch
                    size="sm"
                    checked={item.enabled}
                    onCheckedChange={(checked) => patchItem(item.id, { enabled: checked })}
                    aria-label={t('projects.settings.promptPrinciples.toggleLocal')}
                  />
                  <Input
                    className="h-7 min-w-0 flex-1 text-xs"
                    defaultValue={item.name}
                    placeholder={t('projects.settings.promptPrinciples.namePlaceholder')}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next !== item.name) patchItem(item.id, { name: next });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-foreground-passive hover:text-foreground"
                    aria-label={t('projects.settings.promptPrinciples.remove')}
                    onClick={() =>
                      update(
                        'promptPrinciples',
                        setProjectItems(
                          project,
                          items.filter((entry) => entry.id !== item.id)
                        )
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  className="min-h-16 text-xs"
                  defaultValue={item.text}
                  placeholder={t('projects.settings.promptPrinciples.textPlaceholder')}
                  onBlur={(event) => {
                    const next = event.target.value;
                    if (next !== item.text) patchItem(item.id, { text: next });
                  }}
                />
              </div>
            ))}
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() =>
                update(
                  'promptPrinciples',
                  setProjectItems(project, [
                    ...items,
                    { id: crypto.randomUUID(), name: '', text: '', enabled: true },
                  ])
                )
              }
            >
              <Plus className="size-3.5" />
              {t('projects.settings.promptPrinciples.add')}
            </Button>
          </div>
        </Field>
      </div>
    </>
  );
});
