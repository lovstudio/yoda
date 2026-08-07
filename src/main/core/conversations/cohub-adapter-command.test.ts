import { describe, expect, it } from 'vitest';
import { buildCohubAdapterCommand, getCohubAdapterEnvironment } from './cohub-adapter-command';

describe('buildCohubAdapterCommand', () => {
  it('launches the bundled adapter and keeps the prompt out of plain argv', () => {
    const result = buildCohubAdapterCommand(
      {
        cohubCommand: { command: 'cohub', args: ['prompt', '--read-only'] },
        conversationId: 'conversation-1',
        cwd: '/repo/task',
        initialPrompt: '检查这个项目',
      },
      {
        appPath: '/app',
        execPath: '/app/Electron',
        userDataPath: '/data/yoda',
      }
    );

    expect(result.command).toBe('/app/Electron');
    expect(result.args[0]).toBe('/app/out/main/cohub-runtime-adapter.js');
    expect(result.args).toContain('/data/yoda/cohub/sessions/conversation-1.json');
    expect(result.args).not.toContain('检查这个项目');
    const encodedPrompt = result.args[result.args.indexOf('--initial-prompt') + 1];
    expect(Buffer.from(encodedPrompt, 'base64url').toString('utf8')).toBe('检查这个项目');
  });

  it('forces Electron node mode and disables Cohub self-update', () => {
    expect(getCohubAdapterEnvironment()).toEqual({
      COHUB_CLI_AUTO_UPDATE: '0',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });
});
