import type { AgentProviderId } from '@shared/agent-provider-registry';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import { makeClaudeHookCommand, makeOpenCodePluginContent } from './agent-notify-command';
import piYodaExtension from './pi-yoda-extension.ts?raw';

// Substrings that identify a Yoda-managed hook entry so we can replace our own
// without clobbering user-defined hooks. Includes the legacy `YODA_HOOK_PORT`
// (spawn-time env) so projects that still carry the old form get it rewritten
// to the endpoint-file form on the next write.
const YODA_MARKERS = ['hook-endpoint.json', 'YODA_HOOK_PORT', 'YODA_PTY_ID'];

function isYodaManagedHook(entry: unknown): boolean {
  const serialized = JSON.stringify(entry);
  return YODA_MARKERS.some((marker) => serialized.includes(marker));
}

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const PI_YODA_EXTENSION_PATH = '.pi/extensions/yoda-hook.ts';
const OPENCODE_PLUGIN_PATH = '.opencode/plugins/yoda-notifications.js';
const GITIGNORE_PATH = '.gitignore';
type HookConfigWriteOptions = { writeGitIgnoreEntries?: boolean };

/**
 * Tools that block waiting for the user to make a choice. Claude Code does NOT
 * fire a `Notification` hook for these (that's reserved for permission prompts
 * and idle), so without a dedicated `PreToolUse` hook Yoda never learns the
 * session is waiting on input. `PostToolUse` on the same tools fires once the
 * user answers, returning the session to `working`.
 */
const CLAUDE_INTERACTIVE_TOOL_MATCHER = 'AskUserQuestion|ExitPlanMode';

const HOOK_EVENT_MAP = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
  {
    eventType: 'awaiting-input',
    hookKey: 'PreToolUse',
    matcher: CLAUDE_INTERACTIVE_TOOL_MATCHER,
  },
  {
    eventType: 'awaiting-input-resolved',
    hookKey: 'PostToolUse',
    matcher: CLAUDE_INTERACTIVE_TOOL_MATCHER,
  },
] satisfies { eventType: string; hookKey: string; matcher?: string }[];

export class HookConfigWriter {
  constructor(
    private readonly fs: FileSystemProvider,
    private readonly exec: IExecutionContext
  ) {}

  async writeClaudeHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('claude', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(CLAUDE_SETTINGS_PATH))
      ? await this.fs
          .read(CLAUDE_SETTINGS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    for (const entry of HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[entry.hookKey]) ? hooks[entry.hookKey] : [];
      const matcher = 'matcher' in entry ? entry.matcher : undefined;
      hooks[entry.hookKey] = this.buildHookEntries(
        existing,
        makeClaudeHookCommand(entry.eventType),
        matcher
      );
    }

    await this.fs.write(CLAUDE_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writePiExtension(): Promise<boolean> {
    if (!(await resolveCommandPath('pi', this.exec))) return false;

    const existing = await this.fs
      .read(PI_YODA_EXTENSION_PATH)
      .then((r) => r.content)
      .catch(() => undefined);
    if (existing === piYodaExtension) return true;

    await this.fs.write(PI_YODA_EXTENSION_PATH, piYodaExtension);
    return true;
  }

  async writeOpenCodePlugin(): Promise<boolean> {
    if (!(await resolveCommandPath('opencode', this.exec))) return false;

    const pluginContent = makeOpenCodePluginContent();
    const existing = await this.fs
      .read(OPENCODE_PLUGIN_PATH)
      .then((r) => r.content)
      .catch(() => undefined);
    if (existing === pluginContent) return true;

    await this.fs.write(OPENCODE_PLUGIN_PATH, pluginContent);
    return true;
  }

  async writeForProvider(
    providerId: AgentProviderId,
    options: HookConfigWriteOptions = {}
  ): Promise<void> {
    const writeGitIgnoreEntries = options.writeGitIgnoreEntries ?? true;

    if (providerId === 'claude') {
      const wroteConfig = await this.writeClaudeHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([CLAUDE_SETTINGS_PATH]);
      }
      return;
    }

    if (providerId === 'codex') {
      return;
    }

    if (providerId === 'pi') {
      const wroteConfig = await this.writePiExtension();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([PI_YODA_EXTENSION_PATH]);
      }
      return;
    }

    if (providerId === 'opencode') {
      const wroteConfig = await this.writeOpenCodePlugin();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([OPENCODE_PLUGIN_PATH]);
      }
      return;
    }
  }

  async writeAll(options: HookConfigWriteOptions = {}): Promise<void> {
    await Promise.all(
      (['claude', 'codex', 'pi', 'opencode'] as const).map((providerId) =>
        this.writeForProvider(providerId, options).catch((err: Error) => {
          log.warn(`Failed to write ${providerId} hook config`, { error: String(err) });
        })
      )
    );
  }

  private buildHookEntries(existing: unknown[], command: string, matcher?: string): unknown[] {
    const userEntries = existing.filter((entry) => !isYodaManagedHook(entry));
    const entry = matcher
      ? { matcher, hooks: [{ type: 'command', command }] }
      : { hooks: [{ type: 'command', command }] };
    return [...userEntries, entry];
  }

  private async ensureGitIgnoreEntries(entries: string[]): Promise<void> {
    const existingGitIgnore = await this.fs
      .read(GITIGNORE_PATH)
      .then((result) => result.content)
      .catch(() => '');

    const existingEntries = existingGitIgnore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    const missing = entries.filter((entry) => !this.isGitIgnored(existingEntries, entry));

    if (missing.length === 0) return;

    const content = existingGitIgnore.replace(/\s*$/, '');
    const next =
      content.length > 0 ? `${content}\n${missing.join('\n')}\n` : `${missing.join('\n')}\n`;
    await this.fs.write(GITIGNORE_PATH, next);
  }

  private isGitIgnored(existingEntries: string[], entry: string): boolean {
    const normalizedEntry = entry.replace(/^\/+/, '');
    return existingEntries.some((rawPattern) => {
      const pattern = rawPattern.replace(/^\/+/, '');
      if (pattern === normalizedEntry) return true;

      if (pattern.endsWith('/')) {
        return normalizedEntry.startsWith(pattern);
      }

      if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -2);
        return normalizedEntry.startsWith(prefix);
      }

      return false;
    });
  }
}
