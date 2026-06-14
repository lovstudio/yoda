import { Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';
import { isImeComposing } from '@renderer/utils/ime';

type ArchiveTaskWithNoteModalArgs = {
  projectId: string;
  taskId: string;
  taskName: string;
  /**
   * Skill mode: surface an editable pre-archive command (prefilled from the
   * configured preset) that runs against every live session before archiving.
   * Default (omitted) archives directly with only an optional note.
   */
  withSkill?: boolean;
};

type Props = BaseModalProps<void> & ArchiveTaskWithNoteModalArgs;

const MAX_ARCHIVE_NOTE_LENGTH = 280;

export const ArchiveTaskWithNoteModal = observer(function ArchiveTaskWithNoteModal({
  projectId,
  taskId,
  taskName,
  withSkill = false,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { value: homeDraft } = useAppSettingsKey('homeDraft');

  const [note, setNote] = useState('');
  // Prefill from the configured preset; the user can edit / append before
  // running it (or clear it to archive without a skill).
  const [command, setCommand] = useState(() =>
    withSkill ? (homeDraft?.preArchiveCommand ?? '') : ''
  );

  const { archiveTask } = useArchiveTask(projectId);

  const handleSubmit = useCallback(() => {
    const trimmedCommand = command.trim();
    // The archive flow can run for minutes (pre-archive commands against every
    // live conversation), so it continues in the background — progress shows as
    // loading states on the task row and conversation tabs, not in this dialog.
    void archiveTask(taskId, {
      note,
      // Skill mode forwards the (possibly edited) command; an emptied field
      // degrades to a direct archive. The note path always skips the skill.
      ...(withSkill
        ? trimmedCommand
          ? { preArchiveCommand: trimmedCommand }
          : { skipPreCommand: true }
        : { skipPreCommand: true }),
    }).catch((e: unknown) => {
      toast({
        title: t('sidebar.archiveTask'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    });
    onSuccess();
  }, [archiveTask, taskId, note, command, withSkill, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.archiveWithNote.title', { name: taskName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          {withSkill && (
            <Field>
              <FieldLabel>{t('tasks.archiveWithNote.skillLabel')}</FieldLabel>
              <Textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('settings.tasks.preArchiveCommandPlaceholder')}
                rows={3}
                autoFocus
              />
              <FieldDescription>{t('tasks.archiveWithNote.skillDescription')}</FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel>{t('tasks.archiveWithNote.label')}</FieldLabel>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) {
                  handleSubmit();
                }
              }}
              placeholder={t('tasks.archiveWithNote.placeholder')}
              maxLength={MAX_ARCHIVE_NOTE_LENGTH}
              autoFocus={!withSkill}
            />
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter className={withSkill ? 'sm:justify-between' : undefined}>
        {withSkill && (
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              navigate('settings', { tab: 'sessions' });
            }}
          >
            <Settings2 className="size-4" />
            {t('tasks.context.configureArchiveSkill')}
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ConfirmButton onClick={handleSubmit}>{t('tasks.archiveWithNote.submit')}</ConfirmButton>
        </div>
      </DialogFooter>
    </>
  );
});
