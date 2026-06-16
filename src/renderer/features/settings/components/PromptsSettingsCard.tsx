import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptPrinciple } from '@shared/project-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';

/**
 * Manages the user's atomic prompt principles. Enabled principles are appended
 * after the runtime's system prompt when a session spawns for runtimes that
 * support prompt extension, and surface in the session panel's Persona section.
 */
const PromptsSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const { value, update, isLoading } = useAppSettingsKey('promptPrinciples');
  const items = value?.items ?? [];

  const setItems = (next: PromptPrinciple[]) => update({ items: next });
  const patchItem = (id: string, patch: Partial<PromptPrinciple>) =>
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-foreground-passive">{t('settings.prompts.description')}</p>
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
                aria-label={t('settings.prompts.toggle')}
              />
              <Input
                className="h-7 min-w-0 flex-1 text-xs"
                defaultValue={item.name}
                placeholder={t('settings.prompts.namePlaceholder')}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== item.name) patchItem(item.id, { name: next });
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-foreground-passive hover:text-foreground"
                aria-label={t('settings.prompts.remove')}
                onClick={() => setItems(items.filter((entry) => entry.id !== item.id))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Textarea
              className="min-h-16 text-xs"
              defaultValue={item.text}
              placeholder={t('settings.prompts.textPlaceholder')}
              onBlur={(event) => {
                const next = event.target.value;
                if (next !== item.text) patchItem(item.id, { text: next });
              }}
            />
          </div>
        ))}
        {!isLoading && items.length === 0 ? (
          <p className="text-xs text-foreground-passive">{t('settings.prompts.empty')}</p>
        ) : null}
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() =>
            setItems([...items, { id: crypto.randomUUID(), name: '', text: '', enabled: true }])
          }
        >
          <Plus className="size-3.5" />
          {t('settings.prompts.addPrinciple')}
        </Button>
      </div>
    </div>
  );
};

export default PromptsSettingsCard;
