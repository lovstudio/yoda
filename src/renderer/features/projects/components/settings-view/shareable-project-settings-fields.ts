import type { ShareableProjectSettingsWriteField } from '@shared/project-settings';

export type ShareableFieldFormKey =
  | 'preservePatterns'
  | 'shellSetup'
  | 'scriptSetup'
  | 'scriptRun'
  | 'scriptTeardown'
  | 'docsLocalPath'
  | 'docsCloudUrl';

export type ShareableFieldDescriptor = {
  id: ShareableProjectSettingsWriteField;
  formKey: ShareableFieldFormKey;
  modalLabel: string;
  leafLabel: string;
  defaultWrite: boolean;
  normalizeText(value: string): string;
  placeholder?: string;
  description?: string;
  multiline: boolean;
  group?: 'lifecycle' | 'docs';
};

function trimText(value: string): string {
  return value.trim();
}

function normalizePatternList(value: string): string {
  return value
    .split('\n')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .join('\n');
}

export const SHAREABLE_FIELD_DESCRIPTORS: ShareableFieldDescriptor[] = [
  {
    id: 'preservePatterns',
    formKey: 'preservePatterns',
    modalLabel: 'Preserve patterns',
    leafLabel: 'preserve patterns',
    defaultWrite: true,
    normalizeText: normalizePatternList,
    placeholder: '.env\n.env.local',
    description:
      'Gitignored and untracked files matching these glob patterns are copied from the main repo into each worktree. One pattern per line.',
    multiline: true,
  },
  {
    id: 'shellSetup',
    formKey: 'shellSetup',
    modalLabel: 'Shell setup',
    leafLabel: 'shell setup',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'nvm use\nsource .envrc',
    description: 'Shell commands run before the agent starts in each worktree session',
    multiline: true,
  },
  {
    id: 'scripts.setup',
    formKey: 'scriptSetup',
    modalLabel: 'Setup script',
    leafLabel: 'setup',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'npm install\ncp .env.example .env',
    multiline: true,
    group: 'lifecycle',
  },
  {
    id: 'scripts.run',
    formKey: 'scriptRun',
    modalLabel: 'Run script',
    leafLabel: 'run',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'npm run dev',
    multiline: true,
    group: 'lifecycle',
  },
  {
    id: 'scripts.teardown',
    formKey: 'scriptTeardown',
    modalLabel: 'Teardown script',
    leafLabel: 'teardown',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'docker compose down',
    multiline: true,
    group: 'lifecycle',
  },
  {
    id: 'docs.localPath',
    formKey: 'docsLocalPath',
    modalLabel: 'Local docs path',
    leafLabel: 'local docs path',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'docs',
    description: 'Repo-relative directory of markdown files rendered on the Docs page.',
    multiline: false,
    group: 'docs',
  },
  {
    id: 'docs.cloudUrl',
    formKey: 'docsCloudUrl',
    modalLabel: 'Cloud docs URL',
    leafLabel: 'cloud docs URL',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'https://docs.example.com',
    description: 'URL of a deployed docs site, opened in-app on the Docs page.',
    multiline: false,
    group: 'docs',
  },
];

export const SHAREABLE_FIELD_DESCRIPTOR_BY_ID = Object.fromEntries(
  SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor])
) as Record<ShareableProjectSettingsWriteField, ShareableFieldDescriptor>;

export const DEFAULT_WRITE_FIELDS: ShareableProjectSettingsWriteField[] = [
  ...SHAREABLE_FIELD_DESCRIPTORS.filter((descriptor) => descriptor.defaultWrite).map(
    (descriptor) => descriptor.id
  ),
  'promptPrinciples',
];

export const SHAREABLE_FIELD_FORM_KEY = Object.fromEntries(
  SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor.formKey])
) as Record<ShareableProjectSettingsWriteField, ShareableFieldFormKey>;
