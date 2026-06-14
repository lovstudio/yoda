import { FolderPlus, Zap } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { basenameFromAnyPath } from '@shared/path-name';
import { projectDisplayName } from '@shared/projects';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';

interface ProjectOption {
  kind: 'project';
  value: string;
  label: string;
  path: string;
}

interface ProjectlessOption {
  kind: 'projectless';
  value: '__projectless__';
  label: string;
  description: string;
}

interface BrowseOption {
  kind: 'browse';
  value: '__browse__';
  label: string;
}

interface ExpressOption {
  kind: 'express';
  value: '__express__';
  label: string;
}

type ProjectSelectorOption = ProjectOption | ProjectlessOption | BrowseOption | ExpressOption;

interface ProjectSelectorProps {
  value: string | undefined;
  onChange: (projectId: string | undefined) => void;
  trigger?: React.ReactNode;
  allowProjectless?: boolean;
  initializeGitRepositoryOnPick?: boolean;
}

export const ProjectSelector = observer(function ProjectSelector({
  value,
  onChange,
  trigger,
  allowProjectless = false,
  initializeGitRepositoryOnPick = false,
}: ProjectSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');
  const { toast } = useToast();
  const showExpressCreateModal = useShowModal('expressCreateProjectModal');

  const options: ProjectOption[] = Array.from(getProjectManagerStore().projects.entries()).flatMap(
    ([id, store]) => {
      const mounted = asMounted(store);
      if (!mounted || mounted.data.isInternal) return [];
      return [
        {
          kind: 'project',
          value: id,
          label: projectDisplayName(mounted.data),
          path: mounted.data.path,
        },
      ];
    }
  );
  const projectlessOption: ProjectlessOption = {
    kind: 'projectless',
    value: '__projectless__',
    label: t('projects.noProject'),
    description: t('projects.noProjectTooltip'),
  };
  const browseOption: BrowseOption = {
    kind: 'browse',
    value: '__browse__',
    label: browsing ? t('projects.opening') : t('projects.browseForFolder'),
  };
  const trimmedQuery = query.trim();
  const expressOption: ExpressOption = {
    kind: 'express',
    value: '__express__',
    label: trimmedQuery
      ? t('projects.expressCreateNamed', { name: trimmedQuery })
      : t('projects.expressCreate'),
  };
  const optionGroups: Array<{ value: string; items: ProjectSelectorOption[] }> = [
    { value: 'options', items: options },
    {
      value: 'actions',
      items: [browseOption, expressOption, ...(allowProjectless ? [projectlessOption] : [])],
    },
  ];

  const selectedOption =
    options.find((o) => o.value === value) ??
    (allowProjectless && !value ? projectlessOption : null);
  const isProjectlessSelected = allowProjectless && !value;

  function handleValueChange(item: ProjectSelectorOption | null) {
    if (!item) {
      onChange(undefined);
      setOpen(false);
      return;
    }
    if (item.kind === 'browse') {
      setOpen(false);
      void handleBrowse();
      return;
    }
    if (item.kind === 'express') {
      setOpen(false);
      showExpressCreateModal({
        defaultName: trimmedQuery,
        onSuccess: (projectId) => onChange(projectId),
      });
      return;
    }
    if (item.kind === 'projectless') {
      onChange(undefined);
      setOpen(false);
      return;
    }
    onChange(item.value);
    setOpen(false);
  }

  async function handleBrowse() {
    if (browsing) return;
    setBrowsing(true);
    try {
      const path = await rpc.app.openSelectDirectoryDialog({
        title: t('projects.selectLocalProject'),
        message: t('projects.selectProjectDirectory'),
      });
      if (!path) return;

      const status = await rpc.projects.inspectProjectPath({ type: 'local', path });
      if (!status.isDirectory) {
        toast({
          title: t('projects.cannotAddProject'),
          description: t('projects.pickFolderDescription'),
          variant: 'destructive',
        });
        return;
      }
      if (status.existingProject) {
        onChange(status.existingProject.id);
        setOpen(false);
        return;
      }
      if (!status.isGitRepo && !initializeGitRepositoryOnPick) {
        toast({
          title: t('projects.cannotAddProject'),
          description: t('projects.notGitRepository', { name: basenameFromAnyPath(path) }),
          variant: 'destructive',
        });
        return;
      }

      const projectId = await getProjectManagerStore().createProject(
        { type: 'local' },
        {
          mode: 'pick',
          name: basenameFromAnyPath(path),
          path,
          initGitRepository: !status.isGitRepo,
        }
      );
      if (projectId) {
        onChange(projectId);
        setOpen(false);
      }
    } catch (err) {
      log.error('Failed to add project from picker:', err);
      toast({
        title: t('projects.cannotAddProject'),
        description: t('projects.failedAddSelectedFolder'),
        variant: 'destructive',
      });
    } finally {
      setBrowsing(false);
    }
  }

  const triggerNode = trigger ?? (
    <ComboboxTrigger className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none">
      <ComboboxValue placeholder={t('projects.selectProject')} />
    </ComboboxTrigger>
  );
  const renderedTrigger = isProjectlessSelected ? (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
        {triggerNode}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-left">
        {projectlessOption.description}
      </TooltipContent>
    </Tooltip>
  ) : (
    triggerNode
  );

  return (
    <Combobox
      items={optionGroups}
      value={selectedOption}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={setQuery}
      isItemEqualToValue={(a: ProjectSelectorOption, b: ProjectSelectorOption) =>
        a.kind === b.kind && a.value === b.value
      }
      filter={(item: ProjectSelectorOption, q) => {
        if (item.kind === 'browse' || item.kind === 'express') return true;
        const needle = q.toLowerCase();
        if (item.label.toLowerCase().includes(needle)) return true;
        return item.kind === 'project' && item.path.toLowerCase().includes(needle);
      }}
      autoHighlight
    >
      {renderedTrigger}
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxInput
          showTrigger={false}
          showClear={!!value}
          placeholder={t('projects.searchProjects')}
        />
        <ComboboxList className="pb-0">
          {(group: { value: string; items: ProjectSelectorOption[] }) => (
            <ComboboxGroup
              key={group.value}
              items={group.items}
              className={
                group.value === 'actions'
                  ? 'sticky bottom-0 -mx-1 border-t border-border bg-background-quaternary px-1 py-1'
                  : 'py-1'
              }
            >
              <ComboboxCollection>
                {(item: ProjectSelectorOption) => (
                  <ComboboxItem
                    key={item.value}
                    value={item}
                    disabled={item.kind === 'browse' && browsing}
                    aria-label={
                      item.kind === 'projectless'
                        ? `${item.label}: ${item.description}`
                        : item.label
                    }
                  >
                    {item.kind === 'browse' ? (
                      <>
                        <FolderPlus className="size-4 text-foreground-muted" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </>
                    ) : item.kind === 'express' ? (
                      <>
                        <Zap className="size-4 text-foreground-muted" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </>
                    ) : item.kind === 'projectless' ? (
                      <Tooltip>
                        <TooltipTrigger render={<span className="min-w-0 truncate" />}>
                          {item.label}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 text-left">
                          {item.description}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="flex min-w-0 flex-col">
                        <span className="min-w-0 truncate">{item.label}</span>
                        <span className="min-w-0 truncate text-xs text-foreground-muted" dir="rtl">
                          {item.path}
                        </span>
                      </span>
                    )}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
});
