import {
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS,
  type ProjectSettings,
  type QuickAction,
  type ShareableProjectSettings,
  type ShareableProjectSettingsWriteField,
} from './project-settings';

type ShareableFieldAccessor = {
  path: string[];
  get(settings: ShareableProjectSettings): unknown;
  set(settings: ShareableProjectSettings, value: unknown): void;
  clear(settings: ShareableProjectSettings): void;
  displayValue(settings: ShareableProjectSettings): string | null;
};

function ensureScripts(
  settings: ShareableProjectSettings
): NonNullable<ShareableProjectSettings['scripts']> {
  settings.scripts ??= {};
  return settings.scripts;
}

function displayText(value: string | undefined): string | null {
  return value?.trim() ? value : null;
}

function compactScripts(settings: ShareableProjectSettings): void {
  if (settings.scripts && Object.values(settings.scripts).every((value) => value === undefined)) {
    delete settings.scripts;
  }
}

function ensureDocs(
  settings: ShareableProjectSettings
): NonNullable<ShareableProjectSettings['docs']> {
  settings.docs ??= {};
  return settings.docs;
}

function compactDocs(settings: ShareableProjectSettings): void {
  if (settings.docs && Object.values(settings.docs).every((value) => value === undefined)) {
    delete settings.docs;
  }
}

export const SHAREABLE_FIELD_ACCESSORS = {
  preservePatterns: {
    path: ['preservePatterns'],
    get: (settings) => settings.preservePatterns,
    set: (settings, value) => {
      settings.preservePatterns = value as string[] | undefined;
    },
    clear: (settings) => {
      delete settings.preservePatterns;
    },
    displayValue: (settings) => {
      const value = settings.preservePatterns?.filter((pattern) => pattern.trim());
      return value?.length ? value.join('\n') : null;
    },
  },
  shellSetup: {
    path: ['shellSetup'],
    get: (settings) => settings.shellSetup,
    set: (settings, value) => {
      settings.shellSetup = value as string | undefined;
    },
    clear: (settings) => {
      delete settings.shellSetup;
    },
    displayValue: (settings) => displayText(settings.shellSetup),
  },
  'scripts.setup': {
    path: ['scripts', 'setup'],
    get: (settings) => settings.scripts?.setup,
    set: (settings, value) => {
      ensureScripts(settings).setup = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.scripts) delete settings.scripts.setup;
      compactScripts(settings);
    },
    displayValue: (settings) => displayText(settings.scripts?.setup),
  },
  'scripts.run': {
    path: ['scripts', 'run'],
    get: (settings) => settings.scripts?.run,
    set: (settings, value) => {
      ensureScripts(settings).run = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.scripts) delete settings.scripts.run;
      compactScripts(settings);
    },
    displayValue: (settings) => displayText(settings.scripts?.run),
  },
  'scripts.teardown': {
    path: ['scripts', 'teardown'],
    get: (settings) => settings.scripts?.teardown,
    set: (settings, value) => {
      ensureScripts(settings).teardown = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.scripts) delete settings.scripts.teardown;
      compactScripts(settings);
    },
    displayValue: (settings) => displayText(settings.scripts?.teardown),
  },
  quickActions: {
    path: ['quickActions'],
    get: (settings) => settings.quickActions,
    set: (settings, value) => {
      settings.quickActions = value as QuickAction[] | undefined;
    },
    clear: (settings) => {
      delete settings.quickActions;
    },
    displayValue: (settings) => {
      const value = settings.quickActions?.filter((a) => a.label.trim() && a.command.trim());
      return value?.length ? value.map((a) => `${a.label}: ${a.command}`).join('\n') : null;
    },
  },
  'docs.localPath': {
    path: ['docs', 'localPath'],
    get: (settings) => settings.docs?.localPath,
    set: (settings, value) => {
      ensureDocs(settings).localPath = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.docs) delete settings.docs.localPath;
      compactDocs(settings);
    },
    displayValue: (settings) => displayText(settings.docs?.localPath),
  },
  'docs.cloudUrl': {
    path: ['docs', 'cloudUrl'],
    get: (settings) => settings.docs?.cloudUrl,
    set: (settings, value) => {
      ensureDocs(settings).cloudUrl = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.docs) delete settings.docs.cloudUrl;
      compactDocs(settings);
    },
    displayValue: (settings) => displayText(settings.docs?.cloudUrl),
  },
} satisfies Record<ShareableProjectSettingsWriteField, ShareableFieldAccessor>;

export function clearShareableProjectSettingsFields<T extends ProjectSettings>(
  settings: T,
  fields: ShareableProjectSettingsWriteField[]
): T {
  const next: ProjectSettings = {
    ...settings,
    preservePatterns: settings.preservePatterns ? [...settings.preservePatterns] : undefined,
    scripts: settings.scripts ? { ...settings.scripts } : undefined,
    quickActions: settings.quickActions ? [...settings.quickActions] : undefined,
    docs: settings.docs ? { ...settings.docs } : undefined,
  };

  for (const field of fields) {
    SHAREABLE_FIELD_ACCESSORS[field].clear(next);
  }

  return next as T;
}

export function mergeShareableProjectSettings(
  ...sources: ShareableProjectSettings[]
): ShareableProjectSettings {
  const next: ShareableProjectSettings = {};

  for (const source of sources) {
    for (const field of SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS) {
      const value = SHAREABLE_FIELD_ACCESSORS[field].get(source);
      if (value !== undefined) {
        SHAREABLE_FIELD_ACCESSORS[field].set(next, value);
      }
    }
  }

  return next;
}
