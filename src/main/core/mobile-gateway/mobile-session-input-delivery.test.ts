import { describe, expect, it, vi } from 'vitest';
import { submitMobileSessionInput } from './mobile-session-input-delivery';

const target = {
  projectId: 'project',
  taskId: 'task',
  conversationId: 'conversation',
  runtime: 'codex' as const,
};

describe('submitMobileSessionInput', () => {
  it('uses the canonical injector for submitted prompts', async () => {
    const injectPrompt = vi.fn(async () => true);
    const writeInput = vi.fn(async () => true);

    await expect(
      submitMobileSessionInput({
        imagePaths: [],
        input: '也许可以参考 wechaty',
        submit: true,
        target,
        injectPrompt,
        writeInput,
      })
    ).resolves.toBe(true);

    expect(injectPrompt).toHaveBeenCalledWith({
      ...target,
      imagePaths: [],
      prompt: '也许可以参考 wechaty',
    });
    expect(writeInput).not.toHaveBeenCalled();
  });

  it('keeps explicit type-only input separate from submission', async () => {
    const injectPrompt = vi.fn(async () => true);
    const writeInput = vi.fn(async () => true);

    await expect(
      submitMobileSessionInput({
        imagePaths: [],
        input: '第一行\n第二行',
        submit: false,
        target,
        injectPrompt,
        writeInput,
      })
    ).resolves.toBe(true);

    expect(writeInput).toHaveBeenCalledWith('\u001b[200~第一行\n第二行\u001b[201~');
    expect(injectPrompt).not.toHaveBeenCalled();
  });
});
