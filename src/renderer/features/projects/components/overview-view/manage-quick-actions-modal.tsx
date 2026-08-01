import { Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

type ManageQuickActionsModalArgs = { projectId: string };
type Props = BaseModalProps<void> & ManageQuickActionsModalArgs;

function actionsEqual(a: QuickAction[], b: QuickAction[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.label !== y.label ||
      x.command !== y.command ||
      x.kind !== y.kind ||
      x.sourceIntent !== y.sourceIntent
    ) {
      return false;
    }
  }
  return true;
}

export const ManageQuickActionsModal = observer(function ManageQuickActionsModal({
  projectId,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<QuickAction[]>([]);
  const [initial, setInitial] = useState<QuickAction[]>([]);

  useEffect(() => {
    let cancelled = false;
    const settingsStore = getProjectSettingsStore(projectId);
    if (!settingsStore) {
      setError(t('projects.projectNotReady'));
      setLoading(false);
      return;
    }
    void (async () => {
      await settingsStore.pageData.load();
      if (cancelled) return;
      const existing = settingsStore.settings?.quickActions ?? [];
      setActions(existing);
      setInitial(existing);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  const dirty = !actionsEqual(actions, initial);

  const updateLabel = (id: string, label: string) => {
    setActions((current) =>
      current.map((action) => (action.id === id ? { ...action, label } : action))
    );
  };

  const deleteRow = (id: string) => {
    setActions((current) => current.filter((action) => action.id !== id));
  };

  const handleSubmit = async () => {
    if (loading || submitting) return;
    const settingsStore = getProjectSettingsStore(projectId);
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const cleaned = actions.filter((action) => action.label.trim() && action.command.trim());
    const nextSettings = JSON.parse(
      JSON.stringify({ ...currentSettings, quickActions: cleaned })
    ) as typeof currentSettings;
    const updateRes = await settingsStore.save(nextSettings);
    if (!updateRes.success) {
      setError(t('projects.settings.saveFailed'));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('projects.quickActions.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <p className="text-xs text-foreground-muted">{t('projects.quickActions.description')}</p>
        <div className="flex flex-col gap-2">
          {actions.length === 0 ? (
            <p className="py-3 text-xs text-foreground-muted">{t('projects.quickActions.empty')}</p>
          ) : null}
          {actions.map((action) => (
            <div key={action.id} className="flex items-center gap-2">
              <Input
                className="w-32"
                placeholder={t('projects.quickActions.labelPlaceholder')}
                value={action.label}
                disabled={loading}
                onChange={(event) => updateLabel(action.id, event.target.value)}
              />
              <span className="w-16 shrink-0 text-center text-xs text-foreground-muted">
                {t(
                  action.kind === 'command'
                    ? 'projects.quickActions.commandKind'
                    : 'projects.quickActions.skillKind'
                )}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-xs text-foreground-muted',
                  action.kind === 'command' && 'font-mono'
                )}
                title={action.command}
              >
                {action.command}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={loading}
                onClick={() => deleteRow(action.id)}
                aria-label={t('common.remove')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={loading || submitting || !dirty}
        >
          {submitting ? t('common.saving') : t('common.save')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
