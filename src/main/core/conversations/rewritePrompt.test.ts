import { describe, expect, it } from 'vitest';
import {
  buildPromptRewritePrompt,
  cleanRewrittenPrompt,
  resolvePromptRewriteTargetLanguage,
} from './prompt-rewrite-utils';

describe('prompt rewrite helpers', () => {
  it('resolves explicit and inherited target languages', () => {
    expect(resolvePromptRewriteTargetLanguage('zh-CN')).toBe('zh-CN');
    expect(resolvePromptRewriteTargetLanguage('en')).toBe('en');
    expect(resolvePromptRewriteTargetLanguage('app', 'zh-CN')).toBe('zh-CN');
    expect(resolvePromptRewriteTargetLanguage('skip', 'en')).toBeNull();
    expect(resolvePromptRewriteTargetLanguage('prompt', 'en')).toBeNull();
    expect(resolvePromptRewriteTargetLanguage('app')).toBeNull();
  });

  it('builds a rewrite prompt that preserves technical tokens', () => {
    const prompt = buildPromptRewritePrompt({
      prompt: 'Fix src/app.ts and keep {{yoda-image:1}}.',
      targetLanguage: 'en',
      systemPrompt: 'Be faithful.',
    });

    expect(prompt).toContain('Be faithful.');
    expect(prompt).toContain('Rewrite the user');
    expect(prompt).toContain('file paths');
    expect(prompt).toContain('Fix src/app.ts and keep {{yoda-image:1}}.');
  });

  it('cleans accidental markdown fences from rewritten prompts', () => {
    expect(cleanRewrittenPrompt('```text\nFix the issue.\n```')).toBe('Fix the issue.');
  });
});
