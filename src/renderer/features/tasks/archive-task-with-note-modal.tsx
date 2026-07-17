import { Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
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

  // Autofocus the prefilled command textarea with the caret at the end (not
  // position 0). Guarded so it only fires on the initial mount, otherwise the
  // inline ref re-runs on every keystroke and yanks the caret to the end.
  const commandFocusedRef = useRef(false);
  const focusCommandAtEnd = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el || commandFocusedRef.current) return;
    commandFocusedRef.current = true;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const [note, setNote] = useState('');
  // Prefill the *complete* command the user will actually run: resolve the
  // configured preset (a bare skill id) into the target runtime's command
  // form (e.g. `/skill` for claude, `$skill` for codex) up front, instead of
  // showing the raw id and letting the main process prefix it in the
  // background. The user can still edit / append / clear before running.
  const [command, setCommand] = useState(() => {
    if (!withSkill) return '';
    const preset = homeDraft?.preArchiveCommand ?? '';
    if (!preset) return '';
    const conversation = getTaskMenuConversation(asProvisioned(getTaskStore(projectId, taskId)));
    return conversation ? applyAgentCommandPrefix(conversation.runtimeId, preset) : preset;
  });

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
                ref={focusCommandAtEnd}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('settings.tasks.preArchiveCommandPlaceholder')}
                rows={3}
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
      <DialogFooter
        className={
          withSkill ? 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center' : undefined
        }
      >
        {withSkill && (
          <Button
            variant="ghost"
            className="min-w-0 max-w-full justify-start overflow-hidden"
            onClick={() => {
              onClose();
              navigate('settings', { tab: 'sessions' });
            }}
          >
            <Settings2 className="size-4" />
            <span className="truncate">{t('tasks.context.configureArchiveSkill')}</span>
          </Button>
        )}
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ConfirmButton onClick={handleSubmit}>{t('tasks.archiveWithNote.submit')}</ConfirmButton>
        </div>
      </DialogFooter>
    </>
  );
});
