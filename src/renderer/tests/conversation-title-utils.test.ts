import { describe, expect, it } from 'vitest';
import {
  formatConversationTitleForDisplay,
  initialConversationTitle,
  nextDefaultConversationTitle,
} from '@renderer/features/tasks/conversations/conversation-title-utils';

describe('nextDefaultConversationTitle', () => {
  it('uses the agent name without an index for the first conversation', () => {
    const title = nextDefaultConversationTitle('codex', []);
    expect(title).toBe('Codex');
  });

  it('uses the multi-word agent name without an index for the first conversation', () => {
    const title = nextDefaultConversationTitle('claude', []);
    expect(title).toBe('Claude Code');
  });

  it('fills the smallest missing index for a provider', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'codex', title: 'Codex' },
      { providerId: 'codex', title: 'Codex (3)' },
    ]);

    expect(title).toBe('Codex (2)');
  });

  it('appends when there are no gaps', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'codex', title: 'Codex' },
      { providerId: 'codex', title: 'Codex (2)' },
      { providerId: 'codex', title: 'Codex (3)' },
    ]);

    expect(title).toBe('Codex (4)');
  });

  it('recognizes legacy lowercase default titles', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'codex', title: 'codex (1)' },
      { providerId: 'codex', title: 'codex (2)' },
    ]);

    expect(title).toBe('Codex (3)');
  });

  it('recognizes legacy capitalized provider-id titles when agent name differs', () => {
    const title = nextDefaultConversationTitle('claude', [
      { providerId: 'claude', title: 'Claude (1)' },
      { providerId: 'claude', title: 'Claude (2)' },
    ]);

    expect(title).toBe('Claude Code (3)');
  });

  it('ignores other providers and non-default titles', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'claude', title: 'Claude Code' },
      { providerId: 'codex', title: 'release-triage' },
      { providerId: 'codex', title: 'Codex (2)' },
    ]);

    expect(title).toBe('Codex');
  });
});

describe('formatConversationTitleForDisplay', () => {
  it('reformats legacy lowercase default titles to the agent display name', () => {
    expect(formatConversationTitleForDisplay('codex', 'codex (2)')).toBe('Codex (2)');
    expect(formatConversationTitleForDisplay('claude', 'claude (1)')).toBe('Claude Code');
  });

  it('reformats legacy capitalized provider-id titles to the agent display name', () => {
    expect(formatConversationTitleForDisplay('claude', 'Claude (2)')).toBe('Claude Code (2)');
  });

  it('drops the index for the first default conversation', () => {
    expect(formatConversationTitleForDisplay('codex', 'Codex (1)')).toBe('Codex');
    expect(formatConversationTitleForDisplay('claude', 'Claude Code (1)')).toBe('Claude Code');
  });

  it('leaves custom conversation titles unchanged', () => {
    expect(formatConversationTitleForDisplay('codex', 'release-triage')).toBe('release-triage');
  });
});

describe('initialConversationTitle', () => {
  it('uses the first non-empty prompt line for the initial conversation title', () => {
    expect(
      initialConversationTitle('codex', '\n  Fix the onboarding crash on mobile  \nDetails', [])
    ).toBe('Fix the onboarding crash on mobile');
  });

  it('falls back to the provider default when the prompt is empty', () => {
    expect(
      initialConversationTitle('codex', '   ', [
        { providerId: 'codex', title: 'Codex' },
        { providerId: 'codex', title: 'Codex (2)' },
      ])
    ).toBe('Codex (3)');
  });
});
