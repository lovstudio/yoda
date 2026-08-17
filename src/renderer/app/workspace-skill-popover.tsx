import { useQueryClient } from '@tanstack/react-query';
import { Blocks } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import type { CatalogSkill } from '@shared/skills/types';
import { SkillQuickSearchPopover } from '@renderer/features/skills/components/SkillQuickSearchPopover';
import { skillsQuickCatalogQueryOptions } from '@renderer/features/skills/skills-query';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { WORKSPACE_BAR_CARD_CLASS } from './workspace-bar-card';

interface WorkspaceSkillPopoverProps {
  triggerClassName: string;
  triggerLabelClassName: string;
  onInstalled: (skill: CatalogSkill) => void;
  onManageSkills: () => void;
  onInsertSkill: (skill: CatalogSkill) => void;
  runtimeId?: RuntimeId | null;
}

export const WorkspaceSkillPopover = memo(function WorkspaceSkillPopover({
  triggerClassName,
  triggerLabelClassName,
  onInstalled,
  onManageSkills,
  onInsertSkill,
  runtimeId = null,
}: WorkspaceSkillPopoverProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const keepFocusOnCloseRef = useRef(false);

  const prefetchSkillsCatalog = useCallback(() => {
    void queryClient.prefetchQuery(skillsQuickCatalogQueryOptions);
  }, [queryClient]);

  useEffect(() => {
    prefetchSkillsCatalog();
  }, [prefetchSkillsCatalog]);

  const handleInstalled = useCallback(
    (skill: CatalogSkill) => {
      setOpen(false);
      onInstalled(skill);
    },
    [onInstalled]
  );

  const handleManageSkills = useCallback(() => {
    setOpen(false);
    onManageSkills();
  }, [onManageSkills]);

  const handleInsertSkill = useCallback(
    (skill: CatalogSkill) => {
      // The insert hands keyboard focus to the session's terminal; restoring it to
      // this trigger on close would take it straight back.
      keepFocusOnCloseRef.current = true;
      setOpen(false);
      onInsertSkill(skill);
    },
    [onInsertSkill]
  );

  const handleFinalFocus = useCallback(() => {
    if (!keepFocusOnCloseRef.current) return;
    keepFocusOnCloseRef.current = false;
    return false;
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.skill')}
        className={cn(triggerClassName, open && 'bg-background-2 text-foreground')}
        title={t('workspaceRuntime.skill')}
        onFocus={prefetchSkillsCatalog}
        onPointerEnter={prefetchSkillsCatalog}
      >
        <Blocks className="size-3.5" />
        <span className={triggerLabelClassName}>{t('workspaceRuntime.skill')}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[26rem]')}
        finalFocus={handleFinalFocus}
      >
        <SkillQuickSearchPopover
          runtimeId={runtimeId}
          onInsertSkill={handleInsertSkill}
          onInstalled={handleInstalled}
          onManageSkills={handleManageSkills}
        />
      </PopoverContent>
    </Popover>
  );
});
