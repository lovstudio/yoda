import { describe, expect, it, vi } from 'vitest';
import { promptRewriteFailureDescription, resolveSubmitRequirement } from './submit-prompt-rewrite';

describe('submit prompt rewrite helpers', () => {
  it('uses the rewritten prompt when rewrite succeeds', async () => {
    await expect(
      resolveSubmitRequirement({
        rawRequirement: 'hello',
        rewriteRequirement: vi.fn().mockResolvedValue('你好'),
        onRewriteFailure: vi.fn(),
      })
    ).resolves.toBe('你好');
  });

  it('falls back to the original prompt when rewrite fails', async () => {
    const error = new Error('Codex command failed: missing auth');
    const onRewriteFailure = vi.fn();

    await expect(
      resolveSubmitRequirement({
        rawRequirement: 'hello',
        rewriteRequirement: vi.fn().mockRejectedValue(error),
        onRewriteFailure,
      })
    ).resolves.toBe('hello');

    expect(onRewriteFailure).toHaveBeenCalledWith(error);
  });

  it('formats rewrite failure descriptions', () => {
    expect(promptRewriteFailureDescription(new Error('missing auth'), 'Unknown error')).toBe(
      'missing auth'
    );
    expect(promptRewriteFailureDescription('timed out', 'Unknown error')).toBe('timed out');
    expect(promptRewriteFailureDescription(null, 'Unknown error')).toBe('Unknown error');
  });
});
