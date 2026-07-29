import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations } from '@main/db/schema';
import {
  getStoredConversationSessionSource,
  storeConversationSessionSource,
} from './stored-conversation-session-source';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

const source = {
  catalogId: 'catalog-1',
  runtimeId: 'codex' as const,
  sessionId: 'thread-1',
  stateRoot: '/tmp/codex-home',
};

function selectChain(result: unknown[]) {
  return {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit: vi.fn(async () => result),
  };
}

describe('stored conversation session source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.update.mockReturnValue({
      set: (value: unknown) => ({
        where: () => {
          mocks.updateWhere(value);
          return Promise.resolve();
        },
      }),
    });
  });

  it('preserves existing conversation config while storing a Codex binding', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          runtime: 'codex',
          config: JSON.stringify({ autoApprove: true, permissionMode: 'bypass' }),
        },
      ])
    );

    await expect(storeConversationSessionSource('conversation-1', source)).resolves.toBe(true);

    expect(mocks.update).toHaveBeenCalledWith(conversations);
    const [{ config }] = mocks.updateWhere.mock.calls[0] as [{ config: string }];
    expect(JSON.parse(config)).toEqual({
      autoApprove: true,
      permissionMode: 'bypass',
      sessionSource: source,
    });
  });

  it('does not rewrite an identical binding', async () => {
    mocks.select.mockReturnValue(
      selectChain([{ runtime: 'codex', config: JSON.stringify({ sessionSource: source }) }])
    );

    await expect(storeConversationSessionSource('conversation-1', source)).resolves.toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reads the stored binding', async () => {
    mocks.select.mockReturnValue(
      selectChain([{ config: JSON.stringify({ sessionSource: source }) }])
    );

    await expect(getStoredConversationSessionSource('conversation-1')).resolves.toEqual(source);
  });
});
