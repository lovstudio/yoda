import { describe, expect, it } from 'vitest';
import { appendMobileVoiceTranscript } from './mobile-api';

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
});
