import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Textarea } from '@renderer/lib/ui/textarea';

type ManageRunScriptsModalArgs = {
  projectId: string;
  projectName: string;
};

type Props = BaseModalProps<void> & ManageRunScriptsModalArgs;

export const ManageRunScriptsModal = observer(function ManageRunScriptsModal({
  projectId,
  projectName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [setupScript, setSetupScript] = useState('');
  const [runScript, setRunScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    setup: string;
    run: string;
    teardown: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await rpc.projects.getProjectSettingsPage(projectId);
      if (cancelled) return;
      if (!result.success) {
        setError(t('sidebar.runScripts.loadFailed'));
        setLoading(false);
        return;
      }
      const scripts = result.data.settings.scripts ?? {};
      const initial = {
        setup: scripts.setup ?? '',
        run: scripts.run ?? '',
        teardown: scripts.teardown ?? '',
      };
      setSetupScript(initial.setup);
      setRunScript(initial.run);
      setTeardownScript(initial.teardown);
      setSnapshot(initial);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  const dirty =
    snapshot !== null &&
    (setupScript !== snapshot.setup ||
      runScript !== snapshot.run ||
      teardownScript !== snapshot.teardown);

  const handleSubmit = async () => {
    if (loading || submitting) return;
    setSubmitting(true);
    setError(null);
    const pageResult = await rpc.projects.getProjectSettingsPage(projectId);
    if (!pageResult.success) {
      setError(t('sidebar.runScripts.saveFailed'));
      setSubmitting(false);
      return;
    }
    const next = {
      ...pageResult.data.settings,
      scripts: {
        setup: setupScript.trim() ? setupScript : undefined,
        run: runScript.trim() ? runScript : undefined,
        teardown: teardownScript.trim() ? teardownScript : undefined,
      },
    };
    const updateResult = await rpc.projects.updateProjectSettings(projectId, next);
    if (!updateResult.success) {
      setError(t('sidebar.runScripts.saveFailed'));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.runScripts.title', { name: projectName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <p className="text-xs text-foreground-muted">{t('sidebar.runScripts.description')}</p>
        <FieldGroup>
          <Field>
            <FieldLabel>{t('sidebar.runScripts.beforeRun')}</FieldLabel>
            <Textarea
              rows={3}
              placeholder="npm install"
              value={setupScript}
              disabled={loading}
              onChange={(e) => setSetupScript(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t('sidebar.runScripts.runScript')}</FieldLabel>
            <Textarea
              rows={3}
              placeholder="npm run dev"
              value={runScript}
              disabled={loading}
              onChange={(e) => setRunScript(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t('sidebar.runScripts.teardown')}</FieldLabel>
            <Textarea
              rows={3}
              placeholder="docker compose down"
              value={teardownScript}
              disabled={loading}
              onChange={(e) => setTeardownScript(e.target.value)}
            />
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={loading || submitting || !dirty}
        >
          {submitting ? t('sidebar.runScripts.saving') : t('sidebar.runScripts.save')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
