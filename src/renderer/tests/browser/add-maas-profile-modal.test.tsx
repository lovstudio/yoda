import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type * as DialogModule from '@renderer/lib/ui/dialog';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { maas: { inspectProfileWebsite: vi.fn() } },
}));

vi.mock('@renderer/lib/ui/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof DialogModule>();
  const element = (tag: 'div' | 'h2' | 'p', slot: string) =>
    function MockDialogElement({ children }: { children?: ReactNode }) {
      return createElement(tag, { 'data-slot': slot }, children);
    };

  return {
    ...actual,
    DialogContentArea: element('div', 'dialog-content-area'),
    DialogDescription: element('p', 'dialog-description'),
    DialogFooter: element('div', 'dialog-footer'),
    DialogHeader: element('div', 'dialog-header'),
    DialogTitle: element('h2', 'dialog-title'),
  };
});

describe('AddMaasProfileModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('creates a profile with only a name so the Base URL can be filled later', async () => {
    const onSuccess = vi.fn();
    const { AddMaasProfileModal } = await import(
      '@renderer/features/maas/components/AddMaasProfileModal'
    );

    await act(async () => {
      root.render(
        createElement(AddMaasProfileModal, {
          onClose: vi.fn(),
          onSuccess,
        })
      );
    });

    const skipButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'maas.addProfileModal.skip'
    );
    await act(async () => skipButton?.click());

    const inputs = host.querySelectorAll<HTMLInputElement>('input');
    const nameInput = inputs[0];
    const endpointInput = inputs[2];
    const createButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'maas.addProfileModal.create'
    );

    expect(endpointInput?.value).toBe('');
    expect(host.textContent).toContain('common.optional');
    expect(createButton?.disabled).toBe(true);

    await act(async () => userEvent.fill(nameInput, 'Example MaaS'));
    expect(createButton?.disabled).toBe(false);
    await act(async () => createButton?.click());

    expect(onSuccess).toHaveBeenCalledWith({
      displayName: 'Example MaaS',
      endpoint: '',
      websiteUrl: undefined,
      description: undefined,
      logoUrl: undefined,
    });
  });
});
