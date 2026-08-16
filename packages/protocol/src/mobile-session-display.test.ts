import { describe, expect, it } from 'vitest';
import type { MobileSessionTranscriptBlock } from './mobile-api.js';
import {
  filterMobileSessionTranscript,
  stripInternalAgentReplyMetadata,
} from './mobile-session-display.js';

const transcript: MobileSessionTranscriptBlock[] = [
  { id: 'user', role: 'user', timestamp: null, format: 'plain', content: '请开始' },
  {
    id: 'commentary',
    role: 'assistant',
    agentPhase: 'commentary',
    timestamp: null,
    format: 'plain',
    content: '正在检查',
  },
  { id: 'tool', role: 'tool', timestamp: null, format: 'code', content: 'pnpm test' },
  { id: 'status', role: 'status', timestamp: null, format: 'plain', content: '继续运行' },
  {
    id: 'final',
    role: 'assistant',
    agentPhase: 'final',
    timestamp: null,
    format: 'markdown',
    content: '已完成',
  },
  {
    id: 'legacy-assistant',
    role: 'assistant',
    timestamp: null,
    format: 'plain',
    content: '旧记录中的最终回复',
  },
];

describe('filterMobileSessionTranscript', () => {
  it('keeps only user messages when Agent replies are hidden', () => {
    expect(filterMobileSessionTranscript(transcript, 'hidden').map((block) => block.id)).toEqual([
      'user',
    ]);
  });

  it('keeps final and legacy Agent replies in concise mode', () => {
    expect(filterMobileSessionTranscript(transcript, 'concise').map((block) => block.id)).toEqual([
      'user',
      'final',
      'legacy-assistant',
    ]);
  });

  it('hides only tool calls in detailed mode', () => {
    expect(filterMobileSessionTranscript(transcript, 'detailed').map((block) => block.id)).toEqual([
      'user',
      'commentary',
      'status',
      'final',
      'legacy-assistant',
    ]);
  });

  it('keeps every block in verbose mode without returning the source array', () => {
    const result = filterMobileSessionTranscript(transcript, 'verbose');
    expect(result.map((block) => block.id)).toEqual(transcript.map((block) => block.id));
    expect(result).not.toBe(transcript);
  });

  it('removes internal memory metadata from assistant replies', () => {
    const result = filterMobileSessionTranscript(
      [
        {
          ...transcript[4]!,
          content: `已完成。\n\n<oai-mem-citation>\n内部上下文\n</oai-mem-citation>`,
        },
        {
          ...transcript[5]!,
          id: 'metadata-only',
          content: '<oai-mem-citation>only metadata</oai-mem-citation>',
        },
      ],
      'verbose'
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('已完成。');
    expect(
      stripInternalAgentReplyMetadata('正文\n\n\n<oai-mem-citation>meta</oai-mem-citation>')
    ).toBe('正文');
  });
});
