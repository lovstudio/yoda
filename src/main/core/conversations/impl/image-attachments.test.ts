import { describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { injectClipboardImagesAndPrompt, substituteImageMentions } from './image-attachments';

vi.mock('electron', () => ({
  clipboard: {
    clear: vi.fn(),
    readImage: vi.fn(() => ({ isEmpty: () => true })),
    readText: vi.fn(() => ''),
    writeImage: vi.fn(),
    writeText: vi.fn(),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
  },
}));

class ImmediatelyExitedPty implements Pty {
  readonly pid = 123;

  write(): void {
    throw new Error('input reached an exited PTY');
  }

  resize(): void {}

  kill(): void {}

  onData(): void {}

  onExit(handler: (info: PtyExitInfo) => void): void {
    handler({ exitCode: 0 });
  }
}

describe('image attachments', () => {
  it('rejects immediately when the PTY exited before clipboard delivery listeners attach', async () => {
    await expect(
      injectClipboardImagesAndPrompt({
        pty: new ImmediatelyExitedPty(),
        runtimeId: 'claude',
        imagePaths: ['/tmp/input.png'],
        prompt: 'Inspect {{yoda-image:0}}',
      })
    ).rejects.toThrow('PTY exited before the TUI became ready');
  });

  it('preserves marker order when a runtime uses path mentions', () => {
    expect(
      substituteImageMentions('Before {{yoda-image:1}} after', ['/tmp/a.png', '/tmp/b.png'])
    ).toBe('Before @/tmp/b.png after\n\n@/tmp/a.png');
  });
});
