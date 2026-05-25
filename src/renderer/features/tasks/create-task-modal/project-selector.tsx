import { FolderPlus } from 'lucide-react';
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
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { log } from '@renderer/utils/logger';

interface ProjectOption {
  kind: 'project';
  value: string;
  label: string;
}

interface EmptyProjectOption {
  kind: 'empty';
  value: '__empty_project__';
  label: string;
}

type ProjectSelectorOption = ProjectOption | EmptyProjectOption;

interface ProjectSelectorProps {
  value: string | undefined;
  onChange: (projectId: string | undefined) => void;
  trigger?: React.ReactNode;
}

export const ProjectSelector = observer(function ProjectSelector({
  value,
  onChange,
  trigger,
}: ProjectSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const { toast } = useToast();

  const options: ProjectOption[] = Array.from(getProjectManagerStore().projects.entries()).flatMap(
    ([id, store]) => {
      const mounted = asMounted(store);
      return mounted
        ? [{ kind: 'project', value: id, label: projectDisplayName(mounted.data) }]
        : [];
    }
  );
  const optionGroups: Array<{ value: string; items: ProjectSelectorOption[] }> = [
    {
      value: 'empty',
      items: [{ kind: 'empty', value: '__empty_project__', label: t('projects.noProject') }],
    },
    { value: 'options', items: options },
  ];

  const selectedOption = options.find((o) => o.value === value) ?? null;

  function handleValueChange(item: ProjectSelectorOption | null) {
    if (!item || item.kind === 'empty') {
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
      if (!status.isGitRepo) {
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
          initGitRepository: false,
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

  return (
    <Combobox
      items={optionGroups}
      value={selectedOption}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: ProjectSelectorOption, b: ProjectSelectorOption) =>
        a.kind === b.kind && a.value === b.value
      }
      filter={(item: ProjectSelectorOption, query) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      {trigger ?? (
        <ComboboxTrigger className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none">
          <ComboboxValue placeholder={t('projects.selectProject')} />
        </ComboboxTrigger>
      )}
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxInput
          showTrigger={false}
          showClear={!!value}
          placeholder={t('projects.searchProjects')}
        />
        <ComboboxList className="pb-0">
          {(group: { value: string; items: ProjectSelectorOption[] }) => (
            <ComboboxGroup key={group.value} items={group.items} className="py-1">
              <ComboboxCollection>
                {(item: ProjectSelectorOption) => (
                  <ComboboxItem key={item.value} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <ComboboxSeparator />
        <button
          type="button"
          disabled={browsing}
          onMouseDown={(e) => {
            e.preventDefault();
            void handleBrowse();
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-hidden hover:bg-background-quaternary-1 disabled:pointer-events-none disabled:opacity-50"
        >
          <FolderPlus className="size-4 text-foreground-muted" />
          {browsing ? t('projects.opening') : t('projects.browseForFolder')}
        </button>
      </ComboboxContent>
    </Combobox>
  );
});
