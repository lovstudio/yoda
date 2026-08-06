import { describe, expect, it } from 'vitest';
import { getLatestAssistantReply } from './latest-session-reply';
import type { MobileSessionTranscriptBlock } from './mobile-api';

function block(
  id: string,
  role: MobileSessionTranscriptBlock['role'],
  content: string,
  agentPhase?: MobileSessionTranscriptBlock['agentPhase']
): MobileSessionTranscriptBlock {
  return {
    id,
    role,
    content,
    agentPhase,
    timestamp: `2026-08-06T00:00:0${id}.000Z`,
    format: 'markdown',
  };
}

describe('getLatestAssistantReply', () => {
  it('captures only the final answer from the latest user turn', () => {
    const reply = getLatestAssistantReply([
      block('1', 'user', 'Earlier question'),
      block('2', 'assistant', 'Earlier answer', 'final'),
      block('3', 'user', 'Latest question'),
      block('4', 'assistant', 'Working update', 'commentary'),
      block('5', 'tool', 'Tool output'),
      block('6', 'assistant', 'First final paragraph', 'final'),
      block('7', 'assistant', 'Second final paragraph', 'final'),
    ]);

    expect(reply).toMatchObject({
      id: '6:7',
      agentPhase: 'final',
      content: 'First final paragraph\n\nSecond final paragraph',
    });
  });

  it('captures in-progress commentary when there is no final answer yet', () => {
    const reply = getLatestAssistantReply([
      block('1', 'user', 'Question'),
      block('2', 'assistant', 'First update', 'commentary'),
      block('3', 'assistant', 'Second update', 'commentary'),
    ]);

    expect(reply?.content).toBe('First update\n\nSecond update');
    expect(reply?.agentPhase).toBe('commentary');
  });

  it('does not fall back to an older answer while the latest turn has no reply', () => {
    expect(
      getLatestAssistantReply([
        block('1', 'user', 'Earlier question'),
        block('2', 'assistant', 'Earlier answer', 'final'),
        block('3', 'user', 'Latest question'),
      ])
    ).toBeNull();
  });
});
