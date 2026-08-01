import { describe, expect, it } from 'vitest';
import type { MobileSessionDetail } from './mobile-api';
import { createYodaSessionShareUpload } from './session-share';

function detail(overrides: Partial<MobileSessionDetail> = {}): MobileSessionDetail {
  return {
    generatedAt: '2026-07-29T01:00:00.000Z',
    session: {
      id: 'private-conversation-id',
      projectId: 'private-project-id',
      taskId: 'private-task-id',
      title: 'Public session title',
      runtimeId: 'codex',
      createdAt: '2026-07-29T00:00:00.000Z',
      lastInteractedAt: null,
      isInitialConversation: true,
      runtimeStatus: 'idle',
      running: false,
      acceptsInput: false,
      resumable: true,
      tmuxEnabled: false,
      sessionId: 'private-runtime-session-id',
    },
    content: '',
    contentLength: 0,
    truncated: false,
    source: 'history',
    transcript: [
      {
        id: 'private-transcript-id',
        role: 'user',
        title: 'You',
        timestamp: '2026-07-29T00:01:00.000Z',
        format: 'markdown',
        content: 'Build the public page.',
      },
      {
        id: 'private-commentary-id',
        role: 'assistant',
        agentPhase: 'commentary',
        title: 'Agent',
        timestamp: '2026-07-29T00:01:30.000Z',
        format: 'markdown',
        content: 'I will inspect the implementation.',
      },
      {
        id: 'private-tool-call-id',
        role: 'tool',
        title: 'Shell',
        timestamp: 'not-a-date',
        format: 'code',
        content: 'pnpm test',
      },
      {
        id: 'private-final-reply-id',
        role: 'assistant',
        agentPhase: 'final',
        title: 'Agent',
        timestamp: '2026-07-29T00:02:00.000Z',
        format: 'markdown',
        content: 'The public page is ready.',
      },
      {
        id: 'private-status-id',
        role: 'status',
        title: 'Status',
        timestamp: '2026-07-29T00:02:01.000Z',
        format: 'plain',
        content: 'Task complete',
      },
    ],
    transcriptTruncated: false,
    ...overrides,
  };
}

describe('createYodaSessionShareUpload', () => {
  it('keeps renderable transcript content without leaking local session coordinates', () => {
    const upload = createYodaSessionShareUpload(detail());
    const serialized = JSON.stringify(upload);

    expect(upload.blocks.map((block) => block.id)).toEqual([
      'block-1',
      'block-2',
      'block-3',
      'block-4',
      'block-5',
    ]);
    expect(upload.blocks[2]?.timestamp).toBeNull();
    expect(upload.blocks[1]?.agentPhase).toBe('commentary');
    expect(upload.blocks[3]?.agentPhase).toBe('final');
    expect(upload.assets).toEqual([]);
    expect(upload.omittedAssetCount).toBe(0);
    expect(serialized).not.toContain('private-project-id');
    expect(serialized).not.toContain('private-task-id');
    expect(serialized).not.toContain('private-conversation-id');
    expect(serialized).not.toContain('private-runtime-session-id');
    expect(serialized).not.toContain('private-transcript-id');
  });

  it('falls back to sanitized mobile terminal content when no transcript is available', () => {
    const upload = createYodaSessionShareUpload(
      detail({
        content: 'Recent session output',
        contentLength: 21,
        truncated: true,
        transcript: [],
      })
    );

    expect(upload.blocks).toEqual([
      {
        id: 'block-1',
        role: 'status',
        timestamp: null,
        format: 'plain',
        content: 'Recent session output',
      },
    ]);
    expect(upload.truncated).toBe(true);
  });
});
