import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReservedCodexThreadIds } from './codex-thread-reservations';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('@main/db/client', () => ({ db: { select: mocks.select } }));

function selectChain(result: unknown[]) {
  return {
    from() {
      return this;
    },
    where: vi.fn(async () => result),
  };
}

describe('Codex thread reservations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reserves both Yoda conversation ids and their provider thread ids', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          id: 'conversation-2',
          config: JSON.stringify({
            sessionSource: {
              catalogId: 'catalog-2',
              runtimeId: 'codex',
              sessionId: 'provider-thread-2',
              stateRoot: '/tmp/codex-home',
            },
          }),
        },
        { id: 'conversation-3', config: null },
      ])
    );

    await expect(getReservedCodexThreadIds('conversation-1')).resolves.toEqual(
      new Set(['conversation-2', 'provider-thread-2', 'conversation-3'])
    );
  });
});
