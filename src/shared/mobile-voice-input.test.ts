import { describe, expect, it } from 'vitest';
import {
  appendMobileVoiceTranscript,
  buildMobileSpeechContextualStrings,
  MOBILE_SPEECH_CONTEXT_MAX_STRINGS,
  resolveMobileSpeechLocale,
} from './mobile-api';

describe('mobile voice input text', () => {
  it('appends Chinese dictation without adding a visual gap', () => {
    expect(appendMobileVoiceTranscript('请帮我分析', '这张图片')).toBe('请帮我分析这张图片');
  });

  it('separates adjacent Latin words and preserves explicit whitespace', () => {
    expect(appendMobileVoiceTranscript('Please inspect', 'this image')).toBe(
      'Please inspect this image'
    );
    expect(appendMobileVoiceTranscript('Please inspect\n', 'this image')).toBe(
      'Please inspect\nthis image'
    );
  });

  it('does not change the draft for an empty recognition result', () => {
    expect(appendMobileVoiceTranscript('keep this', '   ')).toBe('keep this');
  });

  it('matches preferred locales against the recognizer locale list', () => {
    expect(resolveMobileSpeechLocale(['zh-Hans-CN', 'en-CN'], ['en-US', 'zh-CN'])).toBe('zh-CN');
    expect(resolveMobileSpeechLocale(['fr-CA'], ['fr-FR', 'fr-CA'])).toBe('fr-CA');
  });

  it('uses a supported language default instead of passing en-CN through', () => {
    expect(resolveMobileSpeechLocale(['en-CN'], ['en-IE', 'en-US', 'zh-CN'])).toBe('en-US');
    expect(resolveMobileSpeechLocale(['en-CN'], [])).toBe('en-US');
  });

  it('falls back deterministically when the device exposes no usable preference', () => {
    expect(resolveMobileSpeechLocale([], ['en-IE', 'zh-CN'])).toBe('zh-CN');
    expect(resolveMobileSpeechLocale([], [])).toBe('zh-CN');
  });

  it('prioritizes current project context before built-in product hot words', () => {
    const contextualStrings = buildMobileSpeechContextualStrings([
      '  语音输入优化  ',
      'YODA',
      'React Native',
    ]);

    expect(contextualStrings.slice(0, 3)).toEqual(['语音输入优化', 'YODA', 'React Native']);
    expect(contextualStrings.filter((value) => value.toLowerCase() === 'yoda')).toHaveLength(1);
    expect(contextualStrings).toContain('LovStudio');
    expect(contextualStrings).toContain('Codex');
  });

  it('splits long context at sentence boundaries and caps recognizer biasing strings', () => {
    const longContext = `${'移动端语音热词'.repeat(6)}。${'project-context'.repeat(4)}`;
    const contextualStrings = buildMobileSpeechContextualStrings([
      longContext,
      ...Array.from({ length: 80 }, (_, index) => `custom-term-${index}`),
    ]);

    expect(contextualStrings[0]).toBe('移动端语音热词'.repeat(6));
    expect(contextualStrings[1]).toBe('project-context'.repeat(4));
    expect(contextualStrings).toHaveLength(MOBILE_SPEECH_CONTEXT_MAX_STRINGS);
  });
});
