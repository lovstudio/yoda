import { describe, expect, it } from 'vitest';
import {
  buildAppGenerationPrompt,
  extractGeneratedAppFromTranscript,
  parseGeneratedAiLabApp,
} from './app-generation-contract';

describe('AI Lab app generation', () => {
  it('parses a generated single-file app', () => {
    expect(
      parseGeneratedAiLabApp(
        `noise\n---YODA_APP_MANIFEST---\n{"name":"专注钟","description":"一个安静的计时器"}\n---YODA_APP_HTML---\n<!doctype html><html><body>ok</body></html>`
      )
    ).toEqual({
      name: '专注钟',
      description: '一个安静的计时器',
      html: '<!doctype html><html><body>ok</body></html>',
    });
  });

  it('rejects incomplete HTML', () => {
    expect(() =>
      parseGeneratedAiLabApp(
        `---YODA_APP_MANIFEST---\n{"name":"A","description":"B"}\n---YODA_APP_HTML---\n<div />`
      )
    ).toThrow('complete HTML');
  });

  it('puts the natural-language request into the sandbox contract', () => {
    const prompt = buildAppGenerationPrompt('做一个旅行打包清单', {
      projectPath: '/workspace/travel',
      systemPrompt: 'Reuse the existing product language.',
    });
    expect(prompt).toContain('做一个旅行打包清单');
    expect(prompt).toContain('/workspace/travel');
    expect(prompt).toContain('Reuse the existing product language.');
    expect(prompt).toContain('one complete HTML document');
    expect(prompt).toContain('work offline immediately');
    expect(prompt).toContain('window.yoda.ai.editImage');
    expect(prompt).toContain('window.yoda.ai.copyLastError');
    expect(prompt).toContain('openai/gpt-image-2');
    expect(prompt).toContain('high input fidelity');
    expect(prompt).toContain('Do not substitute Canvas filters');
    expect(prompt).toContain('copies it to the clipboard');
  });

  it('extracts the app from the latest completed assistant turn', () => {
    const app = extractGeneratedAppFromTranscript([
      { role: 'user', content: 'Build a timer' },
      { role: 'assistant', content: 'Working on it.' },
      {
        role: 'assistant',
        content: [
          '---YODA_APP_MANIFEST---',
          '{"name":"Timer","description":"A focused timer"}',
          '---YODA_APP_HTML---',
          '<!doctype html><html><body>Timer</body></html>',
        ].join('\n'),
      },
    ]);

    expect(app).toEqual({
      name: 'Timer',
      description: 'A focused timer',
      html: '<!doctype html><html><body>Timer</body></html>',
    });
  });
});
