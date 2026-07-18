import { describe, expect, it } from 'vitest';
import { buildAppGenerationPrompt, parseGeneratedAiLabApp } from './app-generation-contract';

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
    const prompt = buildAppGenerationPrompt('做一个旅行打包清单');
    expect(prompt).toContain('做一个旅行打包清单');
    expect(prompt).toContain('one complete HTML document');
    expect(prompt).toContain('work offline immediately');
  });
});
