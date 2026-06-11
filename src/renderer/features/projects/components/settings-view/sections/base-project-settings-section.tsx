import { FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Branch, Remote } from '@shared/git';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import type { FormState, FormUpdate } from '../project-settings-form-model';

type BaseProjectSettingsSectionProps = {
  projectId: string;
  form: FormState;
  defaultWorktreeDirectory: string;
  remotes: Remote[];
  worktreeDirectoryError: string | null;
  update: FormUpdate;
};

export function BaseProjectSettingsSection({
  projectId,
  form,
  defaultWorktreeDirectory,
  remotes,
  worktreeDirectoryError,
  update,
}: BaseProjectSettingsSectionProps) {
  const { t } = useTranslation();
  const remoteValue = form.remote || 'origin';
  const selectedRemote = remotes.find((remote) => remote.name === remoteValue);

  return (
    <>
      <Field>
        <FieldTitle>{t('projects.settings.worktreeDirectory')}</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          {t('projects.settings.worktreeDirectoryDescription')}
        </FieldDescription>
        <div className="relative">
          <Input
            aria-invalid={worktreeDirectoryError ? true : undefined}
            className={cn(worktreeDirectoryError ? 'pr-44' : undefined)}
            placeholder={defaultWorktreeDirectory}
            value={form.worktreeDirectory}
            onChange={(e) => update('worktreeDirectory', e.target.value)}
          />
          {worktreeDirectoryError ? (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500">
              {worktreeDirectoryError}
            </span>
          ) : null}
        </div>
      </Field>

      <Separator />

      <Field>
        <FieldTitle>{t('projects.defaultBranch')}</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          {t('projects.settings.defaultBranchDescription')}
        </FieldDescription>
        <ProjectBranchSelector
          projectId={projectId}
          value={form.defaultBranch ?? undefined}
          onValueChange={(branch: Branch) => update('defaultBranch', branch)}
        />
      </Field>

      <Separator />

      <Field>
        <FieldTitle>{t('projects.remote')}</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          {t('projects.settings.remoteDescription')}{' '}
          <code className="font-mono text-xs">origin</code>.
        </FieldDescription>
        <Select value={remoteValue} onValueChange={(value) => update('remote', value ?? '')}>
          <SelectTrigger className="w-full min-w-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="min-w-0 truncate">{selectedRemote?.name ?? remoteValue}</span>
            </div>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
            {remotes.length > 0 ? (
              remotes.map((r) => (
                <SelectItem key={r.name} value={r.name} className="py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="relative -top-px shrink-0">{r.name}</span>
                    {r.url ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                        {r.url}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))
            ) : (
              <SelectItem value="origin" className="py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="relative -top-px shrink-0 font-medium">origin</span>
                </div>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>

      <Separator />

      <Field>
        <FieldTitle>{t('projects.settings.statsAuxiliaryPaths')}</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          {t('projects.settings.statsAuxiliaryPathsDescription')}
        </FieldDescription>
        <Textarea
          rows={3}
          className="font-mono text-xs"
          placeholder={t('projects.settings.statsAuxiliaryPathsPlaceholder')}
          value={form.statsAuxiliaryPaths}
          onChange={(e) => update('statsAuxiliaryPaths', e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={async () => {
            const path = await rpc.app.openSelectDirectoryDialog({
              title: t('projects.settings.statsAuxiliaryPathsBrowseTitle'),
              message: t('projects.settings.statsAuxiliaryPathsBrowseMessage'),
            });
            if (!path) return;
            const current = form.statsAuxiliaryPaths.trim();
            update('statsAuxiliaryPaths', current ? `${current}\n${path}` : path);
          }}
        >
          <FolderPlus className="size-3.5" />
          {t('projects.settings.statsAuxiliaryPathsBrowse')}
        </Button>
      </Field>
    </>
  );
}
