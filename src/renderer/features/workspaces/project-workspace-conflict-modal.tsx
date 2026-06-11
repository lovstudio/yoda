import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { projectDisplayName, type Project } from '@shared/projects';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ProjectWorkspaceConflictChoice = 'switch' | 'move';

type Props = BaseModalProps<ProjectWorkspaceConflictChoice> & {
  project: Project;
};

/**
 * Shown when the user adds/opens a project that already belongs to another
 * workspace. Resolves with whether to jump to that workspace or move the
 * project into the active one.
 */
export const ProjectWorkspaceConflictModal = observer(function ProjectWorkspaceConflictModal({
  project,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const workspaceName =
    workspaceStore.workspaces.find((w) => w.id === project.workspaceId)?.name ??
    t('workspaces.defaultTab');

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('workspaces.projectInOtherWorkspace')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <p>
          {t('workspaces.projectInOtherWorkspaceDescription', {
            project: projectDisplayName(project),
            workspace: workspaceName,
          })}
        </p>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="outline" onClick={() => onSuccess('move')}>
          {t('workspaces.moveToCurrentWorkspace')}
        </Button>
        <ConfirmButton onClick={() => onSuccess('switch')}>
          {t('workspaces.goToWorkspace', { workspace: workspaceName })}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
