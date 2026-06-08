import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { MemoryFs } from '@main/core/fs/test-helpers/memory-fs';
import { HookConfigWriter } from './hook-config';

const mockResolveCommandPath = vi.hoisted(() => vi.fn());

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: mockResolveCommandPath,
}));

function makeExecutionContext(): IExecutionContext {
  return {
    supportsLocalSpawn: false,
    exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    execStreaming: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

function makeWriter(fs: MemoryFs): HookConfigWriter {
  return new HookConfigWriter(fs, makeExecutionContext());
}

describe('HookConfigWriter', () => {
  beforeEach(() => {
    mockResolveCommandPath.mockReset();
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/pi');
  });

  it('writes the Pi lifecycle extension and ignores it in git', async () => {
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.get('.pi/extensions/yoda-hook.ts')).toContain("pi.on('agent_end'");
    expect(fs.files.get('.pi/extensions/yoda-hook.ts')).toContain(
      "process.once('uncaughtException'"
    );
    expect(fs.files.get('.pi/extensions/yoda-hook.ts')).toContain("'X-Yoda-Event-Type'");
    expect(fs.files.get('.gitignore')).toBe('.pi/extensions/yoda-hook.ts\n');
  });

  it('does not duplicate the Pi gitignore entry', async () => {
    const fs = new MemoryFs();
    fs.files.set('.gitignore', '.pi/extensions/yoda-hook.ts\n');
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.get('.gitignore')).toBe('.pi/extensions/yoda-hook.ts\n');
  });

  it('skips the Pi extension when pi is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.has('.pi/extensions/yoda-hook.ts')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes the OpenCode notifications plugin and ignores it in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/opencode');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.get('.opencode/plugins/yoda-notifications.js')).toContain('YodaNotifications');
    expect(fs.files.get('.opencode/plugins/yoda-notifications.js')).toContain(
      "event.type === 'session.idle'"
    );
    expect(fs.files.get('.gitignore')).toBe('.opencode/plugins/yoda-notifications.js\n');
  });

  it('does not duplicate the OpenCode gitignore entry', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/opencode');
    const fs = new MemoryFs();
    fs.files.set('.gitignore', '.opencode/plugins/yoda-notifications.js\n');
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.get('.gitignore')).toBe('.opencode/plugins/yoda-notifications.js\n');
  });

  it('skips the OpenCode plugin when opencode is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.has('.opencode/plugins/yoda-notifications.js')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('registers Notification, Stop and interactive-tool PreToolUse/PostToolUse hooks', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/claude');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('claude');

    const settings = JSON.parse(fs.files.get('.claude/settings.local.json')!);
    const hooks = settings.hooks;
    expect(Object.keys(hooks).sort()).toEqual([
      'Notification',
      'PostToolUse',
      'PreToolUse',
      'Stop',
    ]);

    // Interactive-tool waits use a matcher; lifecycle hooks do not.
    expect(hooks.PreToolUse[0].matcher).toBe('AskUserQuestion|ExitPlanMode');
    expect(hooks.PostToolUse[0].matcher).toBe('AskUserQuestion|ExitPlanMode');
    expect(hooks.PreToolUse[0].hooks[0].command).toContain('X-Yoda-Event-Type: awaiting-input');
    expect(hooks.PostToolUse[0].hooks[0].command).toContain(
      'X-Yoda-Event-Type: awaiting-input-resolved'
    );
    // Reads the live endpoint file, not a stale spawn-time port env.
    expect(hooks.Stop[0].hooks[0].command).toContain('hook-endpoint.json');
    expect(hooks.Stop[0].hooks[0].command).not.toContain('YODA_HOOK_PORT');
  });

  it('rewrites a legacy YODA_HOOK_PORT hook without duplicating', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/claude');
    const fs = new MemoryFs();
    fs.files.set(
      '.claude/settings.local.json',
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'curl http://127.0.0.1:$YODA_HOOK_PORT/hook' }] },
            { hooks: [{ type: 'command', command: 'user-owned-hook.sh' }] },
          ],
        },
      })
    );
    const writer = makeWriter(fs);

    await writer.writeForProvider('claude');

    const settings = JSON.parse(fs.files.get('.claude/settings.local.json')!);
    const stop = settings.hooks.Stop;
    // Legacy Yoda hook replaced (one Yoda entry), user hook preserved.
    const yodaEntries = stop.filter((e: { hooks: { command: string }[] }) =>
      e.hooks[0].command.includes('hook-endpoint.json')
    );
    const userEntries = stop.filter((e: { hooks: { command: string }[] }) =>
      e.hooks[0].command.includes('user-owned-hook.sh')
    );
    expect(yodaEntries).toHaveLength(1);
    expect(userEntries).toHaveLength(1);
    expect(JSON.stringify(stop)).not.toContain('YODA_HOOK_PORT');
  });
});
