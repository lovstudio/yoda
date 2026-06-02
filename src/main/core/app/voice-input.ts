import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkMacApp, checkMacAppByName, execFileCommand } from './utils';
import {
  buildMacShortcutAppleScript,
  resolveTypelessFallbackShortcut,
  resolveTypelessShortcutFromSettings,
  type TypelessShortcutResolution,
} from './voice-input-shortcut';

export type TriggerVoiceInputArgs = {
  provider?: 'typeless';
  shortcut?: string;
};

export type TriggerVoiceInputResult = {
  shortcut: string;
  source: TypelessShortcutResolution['source'] | 'argument';
};

const TYPELESS_APP_NAME = 'Typeless';
const TYPELESS_BUNDLE_ID = 'now.typeless.desktop';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getTypelessSettingsPaths = (): string[] => [
  join(homedir(), 'Library', 'Application Support', 'Typeless', 'app-settings.json'),
  join(homedir(), 'Library', 'Application Support', 'typeless', 'app-settings.json'),
  join(homedir(), 'Library', 'Application Support', TYPELESS_BUNDLE_ID, 'app-settings.json'),
];

async function isTypelessInstalled(): Promise<boolean> {
  return (await checkMacApp(TYPELESS_BUNDLE_ID)) || (await checkMacAppByName(TYPELESS_APP_NAME));
}

async function resolveTypelessShortcut(): Promise<TypelessShortcutResolution> {
  for (const settingsPath of getTypelessSettingsPaths()) {
    try {
      const settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as unknown;
      const shortcut = resolveTypelessShortcutFromSettings(settings);
      if (shortcut) return shortcut;
    } catch {
      // Missing or malformed settings should not prevent falling back to Typeless defaults.
    }
  }

  return resolveTypelessFallbackShortcut();
}

async function launchTypeless(): Promise<void> {
  try {
    await execFileCommand('open', ['-gj', '-b', TYPELESS_BUNDLE_ID], { timeout: 3_000 });
    await sleep(200);
    return;
  } catch {
    // Try by app name below; bundle lookup can fail for some local installs.
  }

  await execFileCommand('open', ['-gj', '-a', TYPELESS_APP_NAME], { timeout: 3_000 });
  await sleep(200);
}

async function triggerMacShortcut(shortcut: string): Promise<void> {
  const script = buildMacShortcutAppleScript(shortcut);
  try {
    await execFileCommand('osascript', ['-e', script], { timeout: 3_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not trigger Typeless shortcut. Grant Yoda Accessibility permission in System Settings > Privacy & Security > Accessibility, then try again. (${detail})`
    );
  }
}

export async function triggerVoiceInput(
  args?: TriggerVoiceInputArgs
): Promise<TriggerVoiceInputResult> {
  if (process.platform !== 'darwin') {
    throw new Error('Typeless voice input integration is currently supported on macOS only.');
  }

  if (args?.provider && args.provider !== 'typeless') {
    throw new Error(`Unsupported voice input provider: ${args.provider}`);
  }

  const resolved: TriggerVoiceInputResult = args?.shortcut
    ? { shortcut: args.shortcut, source: 'argument' }
    : await resolveTypelessShortcut();

  if (!args?.shortcut && !(await isTypelessInstalled())) {
    throw new Error('Typeless is not installed.');
  }

  await launchTypeless();
  await triggerMacShortcut(resolved.shortcut);
  return resolved;
}
