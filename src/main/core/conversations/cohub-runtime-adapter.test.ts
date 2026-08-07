import { describe, expect, it } from 'vitest';
import {
  extractFirstJsonObject,
  getCohubProjectStateFile,
  isCohubSandboxReady,
  parseCohubJsonOutput,
  selectReusableCohubSpace,
  splitCohubPromptCommand,
  TerminalPromptDecoder,
} from './cohub-runtime-adapter';

describe('Cohub runtime adapter', () => {
  it('extracts the first complete JSON object from streaming output', () => {
    expect(extractFirstJsonObject('status\n{\n  "spaceId": "space-1"\n}\nrunner log')).toBe(
      '{\n  "spaceId": "space-1"\n}'
    );
    expect(extractFirstJsonObject('{"message":"a } brace"} trailing')).toBe(
      '{"message":"a } brace"}'
    );
  });

  it('parses complete Cohub JSON arrays without collapsing them to one object', () => {
    expect(parseCohubJsonOutput('[{"id":"space-1"},{"id":"space-2"}]')).toEqual([
      { id: 'space-1' },
      { id: 'space-2' },
    ]);
    expect(parseCohubJsonOutput('status\n{"spaceId":"space-1"}\n')).toEqual({
      spaceId: 'space-1',
    });
  });

  it('separates global Cohub arguments from prompt options', () => {
    expect(
      splitCohubPromptCommand({
        command: 'cohub',
        args: ['--space', 'space-1', 'prompt', '--read-only', '--model', 'model-1'],
      })
    ).toEqual({
      command: 'cohub',
      globalArgs: ['--space', 'space-1'],
      promptArgs: ['--read-only', '--model', 'model-1'],
    });
  });

  it('decodes bracketed multiline paste and later follow-up input', () => {
    const decoder = new TerminalPromptDecoder();
    expect(decoder.feed('\u001b[200~第一行\n第二行\u001b[201~\r')).toEqual({
      interrupted: false,
      output: '第一行\r\n第二行\r\n',
      prompts: ['第一行\n第二行'],
    });
    expect(decoder.feed('下一条\r')).toEqual({
      interrupted: false,
      output: '下一条\r\n',
      prompts: ['下一条'],
    });
  });

  it('echoes editable input so the terminal remains visibly interactive', () => {
    const decoder = new TerminalPromptDecoder();
    expect(decoder.feed('继续交互')).toEqual({
      interrupted: false,
      output: '继续交互',
      prompts: [],
    });
    expect(decoder.feed('\u007f并发送\r')).toEqual({
      interrupted: false,
      output: '\b \b并发送\r\n',
      prompts: ['继续交并发送'],
    });
  });

  it('uses a stable project-level state file across conversations', () => {
    expect(getCohubProjectStateFile('/data/yoda/cohub/sessions/a.json', '/repo/task')).toBe(
      getCohubProjectStateFile('/data/yoda/cohub/sessions/b.json', '/repo/task')
    );
    expect(getCohubProjectStateFile('/data/yoda/cohub/sessions/a.json', '/repo/other')).not.toBe(
      getCohubProjectStateFile('/data/yoda/cohub/sessions/a.json', '/repo/task')
    );
  });

  it('selects the one running local Space for the project name', () => {
    expect(
      selectReusableCohubSpace(
        [
          {
            id: 'cloud-space',
            name: 'Yoda · demo',
            sandboxStatus: 'running',
            meta: { config: { sandbox: { provider: 'cloud' } } },
          },
          {
            id: 'local-space',
            name: 'Yoda · demo',
            sandboxStatus: 'running',
            meta: { config: { sandbox: { provider: 'local' } } },
          },
        ],
        'Yoda · demo'
      )?.id
    ).toBe('local-space');
  });

  it('recognizes running Cohub sandboxes unless explicitly unhealthy', () => {
    expect(isCohubSandboxReady({ sandbox: { status: 'running', runtimeStatus: 'healthy' } })).toBe(
      true
    );
    expect(
      isCohubSandboxReady({ sandbox: { status: 'running', runtimeStatus: 'unhealthy' } })
    ).toBe(false);
    expect(isCohubSandboxReady({ sandbox: { status: 'stopped' } })).toBe(false);
  });
});
