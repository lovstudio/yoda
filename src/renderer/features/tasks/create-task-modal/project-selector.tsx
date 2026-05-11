import { FolderPlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { basenameFromAnyPath } from '@shared/path-name';
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
  value: string;
  label: string;
}

interface ProjectSelectorProps {
  value: string | undefined;
  onChange: (projectId: string) => void;
  trigger?: React.ReactNode;
}

export const ProjectSelector = observer(function ProjectSelector({
  value,
  onChange,
  trigger,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const { toast } = useToast();

  const options: ProjectOption[] = Array.from(getProjectManagerStore().projects.entries()).flatMap(
    ([id, store]) => {
      const mounted = asMounted(store);
      return mounted ? [{ value: id, label: mounted.data.name }] : [];
    }
  );

  const selectedOption = options.find((o) => o.value === value) ?? null;

  function handleValueChange(item: ProjectOption | null) {
    if (!item) return;
    onChange(item.value);
    setOpen(false);
  }

  async function handleBrowse() {
    if (browsing) return;
    setBrowsing(true);
    try {
      const path = await rpc.app.openSelectDirectoryDialog({
        title: 'Select a local project',
        message: 'Select a project directory to open',
      });
      if (!path) return;

      const status = await rpc.projects.inspectProjectPath({ type: 'local', path });
      if (!status.isDirectory) {
        toast({
          title: 'Cannot add project',
          description: 'Pick a folder to add it as a project.',
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
          title: 'Cannot add project',
          description: `${basenameFromAnyPath(path)} is not a git repository.`,
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
        title: 'Cannot add project',
        description: 'Failed to add the selected folder as a project.',
        variant: 'destructive',
      });
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <Combobox
      items={[{ value: 'options', items: options }]}
      value={selectedOption}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: ProjectOption, b: ProjectOption) => a.value === b.value}
      filter={(item: ProjectOption, query) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      {trigger ?? (
        <ComboboxTrigger className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none">
          <ComboboxValue placeholder="Select a project" />
        </ComboboxTrigger>
      )}
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder="Search projects..." />
        <ComboboxList className="pb-0">
          {(group: { value: string; items: ProjectOption[] }) => (
            <ComboboxGroup key={group.value} items={group.items} className="py-1">
              <ComboboxCollection>
                {(item: ProjectOption) => (
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
          {browsing ? 'Opening…' : 'Browse for folder…'}
        </button>
      </ComboboxContent>
    </Combobox>
  );
});
