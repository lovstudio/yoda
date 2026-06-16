import { Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { PromptPrinciple } from '@shared/project-settings';
import {
  effectiveGlobalEnabled,
  setGlobalOverride,
  setProjectItems,
} from '@renderer/features/projects/project-prompt-principles';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { FormState, FormUpdate } from '../project-settings-form-model';

type PromptPrinciplesSectionProps = {
  form: FormState;
  update: FormUpdate;
};

export const PromptPrinciplesSection = observer(function PromptPrinciplesSection({
  form,
  update,
}: PromptPrinciplesSectionProps) {
  const { t } = useTranslation();
  const { value: globalValue } = useAppSettingsKey('promptPrinciples');
  const globalItems = globalValue?.items ?? [];
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
            <div className="flex flex-col gap-2">
              {globalItems.map((principle) => (
                <div
                  key={principle.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2"
                >
                  <span className="min-w-0 truncate text-xs text-foreground">
                    {principle.name || t('projects.settings.promptPrinciples.unnamed')}
                  </span>
                  <Switch
                    size="sm"
                    checked={effectiveGlobalEnabled(project, principle)}
                    onCheckedChange={(checked) =>
                      update('promptPrinciples', setGlobalOverride(project, principle, checked))
                    }
                    aria-label={t('projects.settings.promptPrinciples.toggleGlobal')}
                  />
                </div>
              ))}
            </div>
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
