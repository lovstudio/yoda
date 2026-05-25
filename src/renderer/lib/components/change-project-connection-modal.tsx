import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SshConnectionSelector } from '@renderer/features/projects/components/add-project-modal/ssh-connection-selector';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';

export interface ChangeProjectConnectionModalProps {
  projectId: string;
  currentConnectionId: string;
}

export function ChangeProjectConnectionModal({
  projectId,
  currentConnectionId,
  onSuccess,
  onClose,
}: ChangeProjectConnectionModalProps & BaseModalProps<void>) {
  const { t } = useTranslation();
  const [selectedConnectionId, setSelectedConnectionId] = useState(currentConnectionId);
  const [isSaving, setIsSaving] = useState(false);

  const showSshConnModal = useShowModal('addSshConnModal');
  const showChangeConnectionModal = useShowModal('changeProjectConnectionModal');

  const handleAddConnection = () => {
    showSshConnModal({
      onSuccess: (result: unknown) => {
        const newId = (result as { connectionId: string }).connectionId;
        showChangeConnectionModal({ projectId, currentConnectionId: newId });
      },
      onClose: () => {
        showChangeConnectionModal({ projectId, currentConnectionId: selectedConnectionId });
      },
    });
  };

  const handleEditConnection = (id: string) => {
    const conn = appState.sshConnections.connections.find((c) => c.id === id);
    if (!conn) return;
    showSshConnModal({
      initialConfig: conn,
      onSuccess: () => {
        showChangeConnectionModal({ projectId, currentConnectionId: id });
      },
      onClose: () => {
        showChangeConnectionModal({ projectId, currentConnectionId: id });
      },
    });
  };

  const handleSave = async () => {
    if (selectedConnectionId === currentConnectionId) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      await getProjectManagerStore()?.updateProjectConnection(projectId, selectedConnectionId);
      onSuccess();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalLayout
      header={
        <DialogHeader>
          <DialogTitle>{t('ssh.changeConnection')}</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('common.cancel')}
          </Button>
          <ConfirmButton
            onClick={() => void handleSave()}
            disabled={isSaving || !selectedConnectionId}
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </ConfirmButton>
        </DialogFooter>
      }
    >
      <DialogContentArea>
        <Field>
          <FieldLabel>{t('ssh.connection')}</FieldLabel>
          <SshConnectionSelector
            connectionId={selectedConnectionId}
            onConnectionIdChange={setSelectedConnectionId}
            onAddConnection={handleAddConnection}
            onEditConnection={handleEditConnection}
          />
        </Field>
      </DialogContentArea>
    </ModalLayout>
  );
}
