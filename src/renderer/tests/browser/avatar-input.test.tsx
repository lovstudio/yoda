import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarInput } from '@renderer/lib/components/avatar-input';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  clipboardWriteText: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    llm: { generateImage: mocks.generateImage },
    app: { clipboardWriteText: mocks.clipboardWriteText },
  },
}));

describe('AvatarInput', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateImage.mockResolvedValue({
      imageDataUrl: 'data:image/png;base64,YWktYXZhdGFy',
      profileId: 'image',
      profileName: 'Image profile',
      model: 'openai/gpt-image-2',
    });
    mocks.clipboardWriteText.mockResolvedValue({ success: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="dialog-portal"]').forEach((node) => node.remove());
    host.remove();
  });

  it('opens from the profile avatar and applies a local preset', async () => {
    const onChange = vi.fn();
    await renderAvatar(onChange);

    openPicker();
    await settle();

    expect(document.body.textContent).toContain('common.chooseAvatar');
    const presets = document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="common.presetAvatars"]'
    );
    expect(presets).toHaveLength(16);

    await act(async () => presets[0]!.click());
    await settle();
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/svg\+xml/));
    expect(document.querySelector('[data-slot="dialog-content"][data-open]')).toBeNull();
  });

  it('generates a compact avatar through the assigned Yoda AI Profile', async () => {
    const onChange = vi.fn();
    await renderAvatar(onChange);
    openPicker();
    await settle();

    const textarea = document.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]')!;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setValue?.call(textarea, 'an orange robot with round glasses');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    const generateButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('common.avatarGenerate')
    )!;
    await act(async () => generateButton.click());
    await settle();

    expect(mocks.generateImage).toHaveBeenCalledWith({
      prompt: 'an orange robot with round glasses',
    });
    expect(onChange).toHaveBeenCalledWith('data:image/png;base64,YWktYXZhdGFy');
  });

  it('keeps custom local image upload support inside the picker', async () => {
    const onChange = vi.fn();
    await renderAvatar(onChange);
    openPicker();
    await settle();

    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['avatar'], 'avatar.png', { type: 'image/png' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await settle();

    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
  });

  async function renderAvatar(onChange: (value: string) => void) {
    act(() => {
      flushSync(() =>
        root.render(
          <AvatarInput
            id="avatar"
            name="Yoda"
            value=""
            onChange={onChange}
            inputLabel="Avatar"
            placeholder="Emoji"
            uploadTitle="Upload photo"
            clearTitle="Clear avatar"
            appearance="profile"
          />
        )
      );
    });
    await settle();
  }

  function openPicker(): void {
    const trigger = host.querySelector<HTMLButtonElement>('button');
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
  }
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
