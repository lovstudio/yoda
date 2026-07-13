import { Check, Pencil, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_WORKSPACE_NAME_LENGTH, type Workspace } from '@shared/workspaces';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

type Props = BaseModalProps<void>;

/** Central place to rename or remove any user-created workspace. */
export const ManageWorkspacesModal = observer(function ManageWorkspacesModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beginRename = (workspace: Workspace) => {
    setEditingId(workspace.id);
    setValue(workspace.name);
    setRemovingId(null);
    setError(null);
  };

  const cancelRename = () => {
    setEditingId(null);
    setValue('');
    setError(null);
  };

  const saveRename = async (workspace: Workspace) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_WORKSPACE_NAME_LENGTH || busyId) return;
    if (trimmed === workspace.name) {
      cancelRename();
      return;
    }
    setBusyId(workspace.id);
    setError(null);
    try {
      await workspaceStore.renameWorkspace(workspace.id, trimmed);
      cancelRename();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaces.renameFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const removeWorkspace = async (workspace: Workspace) => {
    if (removingId !== workspace.id) {
      setRemovingId(workspace.id);
      setEditingId(null);
      setError(null);
      return;
    }
    setBusyId(workspace.id);
    setError(null);
    try {
      await workspaceStore.deleteWorkspace(workspace.id);
      setRemovingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaces.removeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('workspaces.manage')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-3 pt-0">
        <p className="text-sm text-foreground-muted">{t('workspaces.manageDescription')}</p>
        {workspaceStore.workspaces.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-foreground-muted">
            {t('workspaces.empty')}
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {workspaceStore.workspaces.map((workspace) => {
              const isEditing = editingId === workspace.id;
              const isRemoving = removingId === workspace.id;
              const isBusy = busyId === workspace.id;
              return (
                <div key={workspace.id} className="flex min-h-12 items-center gap-2 px-3 py-2">
                  {isEditing ? (
                    <Input
                      value={value}
                      onChange={(event) => {
                        setValue(event.target.value);
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !isImeComposing(event)) {
                          void saveRename(workspace);
                        } else if (event.key === 'Escape') {
                          cancelRename();
                        }
                      }}
                      maxLength={MAX_WORKSPACE_NAME_LENGTH}
                      className="h-8 min-w-0 flex-1"
                      autoFocus
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm">{workspace.name}</span>
                  )}
                  {isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('common.save')}
                        disabled={!value.trim() || isBusy}
                        onClick={() => void saveRename(workspace)}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('common.cancel')}
                        disabled={isBusy}
                        onClick={cancelRename}
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('workspaces.renameWorkspace', { name: workspace.name })}
                        disabled={busyId !== null}
                        onClick={() => beginRename(workspace)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant={isRemoving ? 'destructive' : 'ghost'}
                        size={isRemoving ? 'sm' : 'icon-sm'}
                        aria-label={t('workspaces.removeWorkspace', { name: workspace.name })}
                        disabled={busyId !== null}
                        onClick={() => void removeWorkspace(workspace)}
                      >
                        <Trash2 className="size-4" />
                        {isRemoving && t('workspaces.confirmRemove')}
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-foreground-muted">{t('workspaces.removeDescription')}</p>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogFooter>
    </>
  );
});
