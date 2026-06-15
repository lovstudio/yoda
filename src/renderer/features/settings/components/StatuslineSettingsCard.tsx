import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { StatuslineTemplate } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';

/**
 * Manages the candidate statusline templates. The active statusline is
 * switched from a session's Harness → Statusline blind against the project
 * root, which writes the chosen command into Claude Code's settings file.
 */
const StatuslineSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const { value, update, isLoading } = useAppSettingsKey('statusline');
  const templates = value?.templates ?? [];

  const setTemplates = (next: StatuslineTemplate[]) => update({ templates: next });
  const patchTemplate = (id: string, patch: Partial<StatuslineTemplate>) =>
    setTemplates(templates.map((tpl) => (tpl.id === id ? { ...tpl, ...patch } : tpl)));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-foreground-passive">{t('settings.statusline.description')}</p>
      <div className="flex flex-col gap-2">
        {templates.map((template) => (
          <div key={template.id} className="flex items-center gap-2">
            <Input
              className="h-7 w-44 text-xs"
              defaultValue={template.name}
              placeholder={t('settings.statusline.namePlaceholder')}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== template.name) patchTemplate(template.id, { name: next });
              }}
            />
            <Input
              className="h-7 min-w-0 flex-1 font-mono text-xs"
              defaultValue={template.command}
              placeholder={t('settings.statusline.commandPlaceholder')}
              onBlur={(event) => {
                const next = event.target.value;
                if (next.trim() && next !== template.command)
                  patchTemplate(template.id, { command: next });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-foreground-passive hover:text-foreground"
              aria-label={t('settings.statusline.remove')}
              onClick={() => setTemplates(templates.filter((tpl) => tpl.id !== template.id))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {!isLoading && templates.length === 0 ? (
          <p className="text-xs text-foreground-passive">{t('settings.statusline.empty')}</p>
        ) : null}
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() =>
            setTemplates([...templates, { id: crypto.randomUUID(), name: '', command: '' }])
          }
        >
          <Plus className="size-3.5" />
          {t('settings.statusline.addTemplate')}
        </Button>
      </div>
    </div>
  );
};

export default StatuslineSettingsCard;
