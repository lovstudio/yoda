import { ChevronsUpDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GithubAuthDisclaimer } from '@renderer/features/integrations/components/github-auth-disclaimer';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ComboboxPopover } from '@renderer/lib/ui/combobox-popover';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { type Strategy } from './add-project-modal';
import { LocalDirectorySelector } from './local-directory-selector';
import { type CloneModeState, type NewModeState, type PickModeState } from './modes';
import { RemoteDirectorySelector } from './remote-directory-selector';

export function PickExistingPanel({
  strategy,
  connectionId,
  state,
  showInitializeGitPrompt,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: PickModeState;
  showInitializeGitPrompt: boolean;
}) {
  const { t } = useTranslation();

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t('projects.addProject.directory')}</FieldLabel>
        {strategy === 'local' ? (
          <LocalDirectorySelector
            path={state.path}
            onPathChange={state.handlePathChange}
            title={t('projects.selectLocalProject')}
            message={t('projects.selectProjectDirectory')}
          />
        ) : (
          <RemoteDirectorySelector
            connectionId={connectionId}
            value={state.path}
            onChange={state.handlePathChange}
          />
        )}
      </Field>
      <Field>
        <FieldLabel>{t('common.name')}</FieldLabel>
        <Input
          placeholder={t('projects.addProject.enterProjectName')}
          value={state.name}
          onChange={(e) => state.handleNameChange(e.target.value)}
        />
      </Field>
      {showInitializeGitPrompt && (
        <div className="overflow-hidden rounded-md border border-border">
          <p className="border-b border-border bg-background-1 px-2 py-1 text-xs text-foreground-muted">
            {t('projects.addProject.notGitRepository')}
          </p>
          <div className="p-2">
            <Field orientation="horizontal">
              <Switch
                checked={state.initGitRepository}
                onCheckedChange={state.setinitGitRepository}
              />
              <FieldLabel>{t('projects.addProject.initializeGitRepository')}</FieldLabel>
            </Field>
          </div>
        </div>
      )}
    </FieldGroup>
  );
}

export function CreateNewPanel({
  strategy,
  connectionId,
  state,
  showGithubAuthDisclaimer,
  onOpenAccountSettings,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: NewModeState;
  showGithubAuthDisclaimer: boolean;
  onOpenAccountSettings: () => void;
}) {
  const { t } = useTranslation();

  if (showGithubAuthDisclaimer) {
    return <GithubAuthDisclaimer onOpenAccountSettings={onOpenAccountSettings} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel>{t('projects.addProject.repositoryName')}</FieldLabel>
          <Input
            autoFocus
            placeholder={t('projects.addProject.enterRepositoryName')}
            value={state.repositoryName}
            onChange={(e) => state.handleRepositoryNameChange(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>{t('projects.addProject.owner')}</FieldLabel>
          <ComboboxPopover
            trigger={
              <ComboboxTrigger
                render={
                  <button className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none">
                    <ComboboxValue />
                    <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                }
              />
            }
            items={state.owners}
            defaultValue={state.repositoryOwner}
            value={state.repositoryOwner ?? null}
            onValueChange={state.handleOwnerChange}
          />
        </Field>
        <Field>
          <FieldLabel>{t('projects.addProject.privacy')}</FieldLabel>
          <RadioGroup
            value={state.repositoryVisibility}
            onValueChange={(value) => state.setRepositoryVisibility(value as 'public' | 'private')}
          >
            <div className="flex items-center gap-3">
              <RadioGroupItem value="private" />
              <Label className="cursor-pointer font-normal">{t('tasks.addRemote.private')}</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="public" />
              <Label className="cursor-pointer font-normal">{t('tasks.addRemote.public')}</Label>
            </div>
          </RadioGroup>
        </Field>
      </FieldGroup>
      <Separator className="w-full" />
      <FieldGroup>
        <Field>
          <FieldLabel>{t('projects.addProject.projectName')}</FieldLabel>
          <Input
            placeholder={t('projects.addProject.enterProjectName')}
            value={state.name}
            onChange={(e) => state.handleNameChange(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>
            {strategy === 'local'
              ? t('projects.addProject.projectDirectory')
              : t('projects.addProject.remoteDirectory')}
          </FieldLabel>
          {strategy === 'local' ? (
            <LocalDirectorySelector
              path={state.path}
              onPathChange={state.setPath}
              title={t('projects.selectLocalProject')}
              message={t('projects.selectProjectDirectory')}
            />
          ) : (
            <RemoteDirectorySelector
              connectionId={connectionId}
              value={state.path}
              onChange={state.setPath}
            />
          )}
        </Field>
      </FieldGroup>
    </div>
  );
}

export function ClonePanel({
  strategy,
  connectionId,
  state,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: CloneModeState;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel>{t('projects.addProject.repositoryUrl')}</FieldLabel>
          <Input
            autoFocus
            placeholder={t('projects.addProject.enterRepositoryUrl')}
            value={state.repositoryUrl}
            onChange={(e) => state.handleRepositoryUrlChange(e.target.value)}
          />
        </Field>
      </FieldGroup>
      <Separator className="w-full" />
      <FieldGroup>
        <Field>
          <FieldLabel>{t('projects.addProject.projectName')}</FieldLabel>
          <Input
            placeholder={t('projects.addProject.enterProjectName')}
            value={state.name}
            onChange={(e) => state.handleNameChange(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>
            {strategy === 'local'
              ? t('projects.addProject.projectDirectory')
              : t('projects.addProject.remoteDirectory')}
          </FieldLabel>
          {strategy === 'local' ? (
            <LocalDirectorySelector
              path={state.path}
              onPathChange={state.setPath}
              title={t('projects.selectLocalProject')}
              message={t('projects.selectProjectDirectory')}
            />
          ) : (
            <RemoteDirectorySelector
              connectionId={connectionId}
              value={state.path}
              onChange={state.setPath}
            />
          )}
        </Field>
      </FieldGroup>
    </div>
  );
}
