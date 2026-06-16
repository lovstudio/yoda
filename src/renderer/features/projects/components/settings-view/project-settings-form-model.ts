import type { Branch } from '@shared/git';
import { projectDefaultBranchToBranch } from '@shared/git-utils';
import type { ProjectSettings, ShareableProjectSettingsWriteField } from '@shared/project-settings';
import {
  SHAREABLE_FIELD_DESCRIPTOR_BY_ID,
  SHAREABLE_FIELD_DESCRIPTORS,
  SHAREABLE_FIELD_FORM_KEY,
} from './shareable-project-settings-fields';

export type FormState = {
  preservePatterns: string;
  shellSetup: string;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
  docsLocalPath: string;
  docsCloudUrl: string;
  worktreeDirectory: string;
  defaultBranch: Branch | null;
  remote: string;
  /** Newline-separated directory paths contributing transcripts to usage stats. */
  statsAuxiliaryPaths: string;
  provisionCommand: string;
  terminateCommand: string;
  /** Carried through opaque — managed by the dedicated quick-actions modal. */
  quickActions?: ProjectSettings['quickActions'];
  /** Carried through opaque — managed by the prompt-principles section. */
  promptPrinciples?: ProjectSettings['promptPrinciples'];
};

export type FormUpdate = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

export type WorkspaceProviderValidationErrors = Partial<
  Record<'provisionCommand' | 'terminateCommand', string>
>;

function normalizeScript(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join('\n');
  return val ?? '';
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function settingsToForm(
  s: ProjectSettings,
  configuredRemote: string,
  remotes: { name: string; url: string }[]
): FormState {
  const configuredRemoteMeta = remotes.find((remote) => remote.name === configuredRemote) ?? {
    name: configuredRemote,
    url: '',
  };

  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    shellSetup: s.shellSetup ?? '',
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    docsLocalPath: s.docs?.localPath ?? '',
    docsCloudUrl: s.docs?.cloudUrl ?? '',
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch:
      projectDefaultBranchToBranch(s.defaultBranch, configuredRemoteMeta, remotes) ?? null,
    remote: s.remote ?? '',
    statsAuxiliaryPaths: (s.statsAuxiliaryPaths ?? []).join('\n'),
    provisionCommand: s.workspaceProvider?.provisionCommand ?? '',
    terminateCommand: s.workspaceProvider?.terminateCommand ?? '',
    quickActions: s.quickActions,
    promptPrinciples: s.promptPrinciples,
  };
}

export function formToSettings(f: FormState): ProjectSettings {
  let defaultBranch: ProjectSettings['defaultBranch'];
  if (f.defaultBranch) {
    defaultBranch =
      f.defaultBranch.type === 'remote'
        ? `${f.defaultBranch.remote.name}/${f.defaultBranch.branch}`
        : f.defaultBranch.branch;
  }
  const preservePatterns = f.preservePatterns
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const scripts = {
    setup: blankToUndefined(f.scriptSetup),
    run: blankToUndefined(f.scriptRun),
    teardown: blankToUndefined(f.scriptTeardown),
  };
  const statsAuxiliaryPaths = f.statsAuxiliaryPaths
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const provisionCommand = blankToUndefined(f.provisionCommand);
  const terminateCommand = blankToUndefined(f.terminateCommand);
  const hasScripts = Object.values(scripts).some((value) => value !== undefined);
  const docs = {
    localPath: blankToUndefined(f.docsLocalPath),
    cloudUrl: blankToUndefined(f.docsCloudUrl),
  };
  const hasDocs = Object.values(docs).some((value) => value !== undefined);
  return {
    preservePatterns: preservePatterns.length > 0 ? preservePatterns : undefined,
    shellSetup: blankToUndefined(f.shellSetup),
    scripts: hasScripts ? scripts : undefined,
    docs: hasDocs ? docs : undefined,
    worktreeDirectory: blankToUndefined(f.worktreeDirectory),
    defaultBranch,
    remote: blankToUndefined(f.remote),
    statsAuxiliaryPaths: statsAuxiliaryPaths.length > 0 ? statsAuxiliaryPaths : undefined,
    workspaceProvider:
      provisionCommand && terminateCommand
        ? {
            type: 'script',
            provisionCommand,
            terminateCommand,
          }
        : undefined,
    quickActions: f.quickActions,
    promptPrinciples: f.promptPrinciples,
  };
}

export function validateWorkspaceProviderCommands(
  form: FormState
): WorkspaceProviderValidationErrors {
  const hasProvisionCommand = form.provisionCommand.trim().length > 0;
  const hasTerminateCommand = form.terminateCommand.trim().length > 0;

  if (hasProvisionCommand === hasTerminateCommand) return {};

  return {
    provisionCommand: hasProvisionCommand
      ? undefined
      : 'Provision command is required when terminate command is set.',
    terminateCommand: hasTerminateCommand
      ? undefined
      : 'Terminate command is required when provision command is set.',
  };
}

export function normalizeShareableFieldValue(
  field: ShareableProjectSettingsWriteField,
  value: string
): string {
  return SHAREABLE_FIELD_DESCRIPTOR_BY_ID[field].normalizeText(value);
}

function hasProjectPromptPrinciples(form: FormState): boolean {
  const value = form.promptPrinciples;
  if (!value) return false;
  const hasOverrides = !!value.globalOverrides && Object.keys(value.globalOverrides).length > 0;
  const hasItems = !!value.items && value.items.length > 0;
  return hasOverrides || hasItems;
}

export function getAvailableWriteFields(form: FormState): ShareableProjectSettingsWriteField[] {
  // Text fields participate via the descriptor table; structured fields
  // (prompt principles) aren't descriptor-backed, so surface them explicitly
  // when they carry content so they can be shared into `.yoda.json`.
  const textFields = SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => descriptor.id).filter(
    (field) => String(form[SHAREABLE_FIELD_FORM_KEY[field]]).trim()
  );
  return hasProjectPromptPrinciples(form) ? [...textFields, 'promptPrinciples'] : textFields;
}

export function areFormStatesEqual(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
