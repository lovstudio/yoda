import { FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RemoteDirectorySelector } from '@renderer/features/projects/components/add-project-modal/remote-directory-selector';
import {
  getProjectManagerStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

type MoveProjectPathModalArgs = {
  projectId: string;
};

type Props = BaseModalProps<void> & MoveProjectPathModalArgs;

export const MoveProjectPathModal = observer(function MoveProjectPathModal({
  projectId,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const project = getProjectStore(projectId);
  const data = project?.data;
  const currentName = data?.name ?? '';
  const currentPath = data?.path ?? '';
  const shouldSyncPathWithName = useRef(pathLeaf(currentPath) === currentName);

  const [name, setName] = useState(currentName);
  const [path, setPath] = useState(currentPath);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedPath = path.trim();
  const isUnchanged = trimmedName === currentName && trimmedPath === currentPath;
  const isValid = Boolean(data && trimmedName && trimmedPath && !isUnchanged);
  const validationMessage = !data
    ? t('sidebar.moveProjectPath.projectMissing')
    : !trimmedName
      ? t('sidebar.moveProjectPath.nameRequired')
      : !trimmedPath
        ? t('sidebar.moveProjectPath.pathRequired')
        : isUnchanged
          ? t('sidebar.moveProjectPath.unchanged')
          : undefined;

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    setError(null);
    if (shouldSyncPathWithName.current) {
      setPath((current) => replacePathLeaf(current, nextName.trim()));
    }
  };

  const handlePathChange = (nextPath: string) => {
    shouldSyncPathWithName.current = false;
    setPath(nextPath);
    setError(null);
  };

  const handleSelectLocalPath = async () => {
    const selected = await rpc.app.openSelectDirectoryDialog({
      title: t('sidebar.moveProjectPath.selectDirectoryTitle'),
      message: t('sidebar.moveProjectPath.selectDirectoryMessage'),
    });
    if (!selected) return;
    handlePathChange(selected);
  };

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await getProjectManagerStore().moveProjectPath(projectId, {
        name: trimmedName,
        path: trimmedPath,
      });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.moveProjectPath.failed'));
      setIsSubmitting(false);
    }
  }, [isValid, projectId, trimmedName, trimmedPath, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('sidebar.moveProjectPath.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('sidebar.moveProjectPath.nameLabel')}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) {
                  void handleSubmit();
                }
              }}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>{t('sidebar.moveProjectPath.pathLabel')}</FieldLabel>
            {data?.type === 'ssh' ? (
              <RemoteDirectorySelector
                connectionId={data.connectionId}
                value={path}
                onChange={handlePathChange}
              />
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={path}
                  onChange={(e) => handlePathChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isImeComposing(e)) {
                      void handleSubmit();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void handleSelectLocalPath()}
                  disabled={!data || isSubmitting}
                  aria-label={t('sidebar.moveProjectPath.selectDirectory')}
                  title={t('sidebar.moveProjectPath.selectDirectory')}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('sidebar.moveProjectPath.pathHint')}
            </p>
            {validationMessage && (
              <p className="mt-1 text-xs text-destructive">{validationMessage}</p>
            )}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? t('sidebar.moveProjectPath.saving') : t('sidebar.moveProjectPath.submit')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});

function pathLeaf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function replacePathLeaf(path: string, leaf: string): string {
  if (!leaf) return path;
  const normalized = path.replace(/[\\/]+$/, '');
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (slashIndex < 0) return leaf;
  return `${normalized.slice(0, slashIndex + 1)}${leaf}`;
}
