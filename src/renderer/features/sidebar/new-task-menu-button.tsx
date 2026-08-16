import { SquarePen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  NEW_TASK_OPEN_MODE_LABEL_KEYS,
  openNewTaskFromPreference,
  otherNewTaskOpenMode,
} from '@renderer/app/open-new-task';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { isAltOnlyModifier, useAltOnlyHeld } from '@renderer/lib/hooks/use-alt-only-held';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { SidebarMenuButton } from './sidebar-primitives';

/**
 * The primary creation entry. Opens a task the way the persisted preference
 * says; holding Alt/Option opens it the other way for one click, and the label
 * names that other mode in parentheses while the key is down so the override is
 * discoverable without a second sidebar entry.
 */
export function NewTaskMenuButton({
  isActive,
  currentProjectId,
}: {
  isActive: boolean;
  currentProjectId?: string;
}) {
  const { t } = useTranslation();
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const altHeld = useAltOnlyHeld();
  const alternateMode = otherNewTaskOpenMode(interfaceSettings?.newTaskOpenMode ?? 'home');
  const alternateLabel = t(NEW_TASK_OPEN_MODE_LABEL_KEYS[alternateMode]);
  const label = altHeld
    ? t('sidebar.newTaskInMode', { mode: alternateLabel })
    : t('sidebar.newTask');
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      void openNewTaskFromPreference(currentProjectId, isAltOnlyModifier(event));
    },
    [currentProjectId]
  );

  return (
    <SidebarMenuButton
      isActive={isActive}
      onClick={handleClick}
      aria-label={label}
      title={t('sidebar.newTaskAltHint', { mode: alternateLabel })}
      className="w-full justify-between"
    >
      <span className="flex items-center gap-2 min-w-0 w-full">
        <SquarePen className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
        <span className="truncate min-w-0">{label}</span>
      </span>
      <ShortcutHint settingsKey="newTask" />
    </SidebarMenuButton>
  );
}
