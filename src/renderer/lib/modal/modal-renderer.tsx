import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { observer } from 'mobx-react-lite';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  modalRegistry,
  type ModalPosition,
  type ModalRegistryEntry,
  type ModalSize,
} from '@renderer/app/modal-registry';
import { ModalLayerKeyProvider } from '@renderer/lib/modal/modal-provider';
import { Dialog, DialogOverlay, DialogPortal } from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { modalStore, type ModalLayer } from './modal-store';

const SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-5xl',
};

const POSITION_CLASSES: Record<ModalPosition, string> = {
  center: 'top-1/2 -translate-y-1/2',
  top: 'top-[15%] translate-y-0',
};

/**
 * One dialog per open panel, bottom to top. Panels stack rather than replace, so a
 * modal opened from a modal leaves its caller mounted underneath — which is what
 * makes falling back to it on dismissal possible at all.
 */
export const ModalRenderer = observer(function ModalRenderer() {
  // One list, so a layer that starts closing keeps its element — and therefore
  // plays its exit animation — instead of being remounted as a closed dialog.
  const layers = [...modalStore.layers, ...modalStore.closing];
  const openKeys = new Set(modalStore.layers.map((layer) => layer.key));
  return (
    <>
      {layers.map((layer) => (
        <ModalLayerDialog key={layer.key} layer={layer} open={openKeys.has(layer.key)} />
      ))}
    </>
  );
});

const ModalLayerDialog = observer(function ModalLayerDialog({
  layer,
  open,
}: {
  layer: ModalLayer;
  open: boolean;
}) {
  const entry = modalRegistry[layer.id as keyof typeof modalRegistry] as
    | ModalRegistryEntry
    | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = entry?.component as React.ComponentType<any> | undefined;
  const isContainerScoped = entry?.scope === 'container';
  const scopeAnchorRef = useRef<HTMLSpanElement>(null);
  const [scopedPortalContainer, setScopedPortalContainer] = useState<
    HTMLElement | null | undefined
  >(null);

  useLayoutEffect(() => {
    if (!isContainerScoped) {
      setScopedPortalContainer(null);
      return;
    }
    setScopedPortalContainer(
      scopeAnchorRef.current?.closest<HTMLElement>('[data-modal-scope-root]') ?? undefined
    );
  }, [isContainerScoped]);

  const handleOpenChange = (
    nextOpen: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    // Only the panel on top can be dismissed: the ones underneath are inert, and a
    // stray event reaching them would take their children down with them.
    if (nextOpen || !modalStore.isTop(layer.key)) return;
    const isPassiveDismiss =
      eventDetails.reason === 'outside-press' || eventDetails.reason === 'escape-key';
    if (modalStore.closeGuardActive && isPassiveDismiss) return;
    modalStore.closeModal();
  };

  const popupRef = useRef<HTMLDivElement>(null);
  const initialFocus = useCallback(() => {
    const target = popupRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    if (!target) return true;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      requestAnimationFrame(() => target.select());
    }
    return target;
  }, []);

  if (!Component) return null;

  return (
    <>
      <span ref={scopeAnchorRef} hidden />
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen) modalStore.finishClosing(layer.key);
        }}
      >
        <DialogPortal container={isContainerScoped ? scopedPortalContainer : undefined}>
          <DialogOverlay className={isContainerScoped ? 'absolute' : undefined} />
          <DialogPrimitive.Popup
            ref={popupRef}
            finalFocus={false}
            initialFocus={initialFocus}
            data-slot="dialog-content"
            onKeyDownCapture={(e) => {
              if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === 'Enter') {
                e.preventDefault();
              }
            }}
            className={cn(
              'fixed left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-background-quaternary text-sm ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
              isContainerScoped && 'absolute max-h-[calc(100%-2rem)]',
              POSITION_CLASSES[entry?.position ?? 'center'],
              SIZE_CLASSES[entry?.size ?? 'md'],
              entry?.className
            )}
          >
            <ModalLayerKeyProvider layerKey={layer.key}>
              <Component {...layer.args} />
            </ModalLayerKeyProvider>
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    </>
  );
});
