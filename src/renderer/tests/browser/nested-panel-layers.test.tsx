import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { Dialog, DialogContent } from '@renderer/lib/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The panel a flow starts from: it opens the next one from inside itself. */
function OuterModal() {
  return (
    <>
      <span data-testid="outer-modal">outer</span>
      <OpenInnerItem />
    </>
  );
}

/** The panel opened on top: it reports a result and expects to be dismissed. */
function InnerModal({ onSuccess }: BaseModalProps<string>) {
  return (
    <button type="button" data-testid="save" onClick={() => onSuccess('saved')}>
      save
    </button>
  );
}

vi.mock('@renderer/app/modal-registry', () => ({
  modalRegistry: {
    outerModal: { component: OuterModal, size: 'lg' },
    innerModal: { component: InnerModal, size: 'lg' },
  },
}));

/**
 * Tailwind is not compiled for browser tests, so the shipped `fixed z-50` on a
 * dialog popup is a no-op here and Base UI's own full-screen backdrop would
 * cover it. These rules restore the layering the app actually ships.
 */
const LAYER_STYLES = `
[data-slot='dialog-content'] {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 50; background: #fff; padding: 8px;
}
[data-slot='dialog-overlay'] { position: fixed; inset: 0; z-index: 50; }
[data-slot='dropdown-menu-content'] { background: #fff; }
*:has(> [data-slot='dropdown-menu-content']) { z-index: 60; }
`;

/** The registry is mocked, so these ids are not in the real modal union. */
const useShowTestModal = useShowModal as unknown as (
  id: string
) => (args: Record<string, unknown>) => void;

function OpenInnerItem() {
  const showInner = useShowTestModal('innerModal');
  return (
    <button type="button" data-testid="open-inner" onClick={() => showInner({})}>
      edit
    </button>
  );
}

/**
 * The other shape this flow takes: the first panel is a local dialog in the view
 * tree, reached through a row menu, and the second is an app-level modal.
 */
function LocalPanelWithMenu() {
  const [outerOpen, setOuterOpen] = useState(true);
  return (
    <>
      <Dialog open={outerOpen} onOpenChange={setOuterOpen}>
        <DialogContent data-testid="outer">
          <DropdownMenu>
            <DropdownMenuTrigger data-testid="row-menu">more</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem render={<OpenInnerItem />} />
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogContent>
      </Dialog>
      <ModalRenderer />
    </>
  );
}

describe('nested panels', () => {
  let host: HTMLDivElement;
  let root: Root | null;
  let style: HTMLStyleElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    style = document.createElement('style');
    style.textContent = LAYER_STYLES;
    document.head.appendChild(style);
  });

  afterEach(async () => {
    modalStore.closeAll();
    if (root) await act(async () => root?.unmount());
    document.querySelectorAll('[data-slot="dialog-content"]').forEach((node) => node.remove());
    style.remove();
    host.remove();
  });

  it('keeps the panel a modal was opened from and falls back to it on success', async () => {
    await act(async () => root?.render(<ModalRenderer />));
    await act(async () => modalStore.setModal('outerModal', {}));
    expect(document.querySelector('[data-testid="outer-modal"]')).not.toBeNull();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="open-inner"]')!);
    expect(document.querySelector('[data-testid="save"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="outer-modal"]')).not.toBeNull();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="save"]')!);

    expect(document.querySelector('[data-testid="save"]')).toBeNull();
    expect(document.querySelector('[data-testid="outer-modal"]')).not.toBeNull();
  });

  it('dismisses only the top panel when clicking away from both', async () => {
    await act(async () => root?.render(<ModalRenderer />));
    await act(async () => modalStore.setModal('outerModal', {}));
    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="open-inner"]')!);

    await userEvent.click(document.body, { position: { x: 4, y: 4 } });

    expect(document.querySelector('[data-testid="save"]')).toBeNull();
    expect(document.querySelector('[data-testid="outer-modal"]')).not.toBeNull();

    // And a second press away then takes the panel underneath.
    await userEvent.click(document.body, { position: { x: 4, y: 4 } });
    expect(document.querySelector('[data-testid="outer-modal"]')).toBeNull();
  });

  it('keeps a local dialog open while a modal opened from its row menu is used', async () => {
    await act(async () => root?.render(<LocalPanelWithMenu />));

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="row-menu"]')!);
    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="open-inner"]')!);
    expect(document.querySelector('[data-testid="save"]')).not.toBeNull();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="save"]')!);

    expect(document.querySelector('[data-testid="save"]')).toBeNull();
    expect(document.querySelector('[data-testid="outer"]')).not.toBeNull();
  });

  it('gives Escape only the top panel when a modal covers a local dialog', async () => {
    await act(async () => root?.render(<LocalPanelWithMenu />));

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="row-menu"]')!);
    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="open-inner"]')!);
    expect(document.querySelector('[data-testid="save"]')).not.toBeNull();

    await userEvent.keyboard('{Escape}');

    expect(document.querySelector('[data-testid="save"]')).toBeNull();
    expect(document.querySelector('[data-testid="outer"]')).not.toBeNull();
  });
});
