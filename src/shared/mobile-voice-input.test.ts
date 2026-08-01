import { describe, expect, it } from 'vitest';
import { appendMobileVoiceTranscript, resolveMobileSpeechLocale } from './mobile-api';

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
});
