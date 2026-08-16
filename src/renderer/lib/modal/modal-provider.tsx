import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { type modalRegistry } from '@renderer/app/modal-registry';
import { useMobxValue } from '@renderer/lib/hooks/use-mobx-value';
import { modalStore } from './modal-store';

export interface BaseModalProps<TResult = unknown> {
  onSuccess: (result: TResult) => void;
  onClose: () => void;
}

type UserArgs<MId extends ModalId> = Omit<ModalArgs<MId>, 'onSuccess' | 'onClose'> & {
  onSuccess?: (
    result: ModalArgs<MId> extends { onSuccess: (result: infer R) => void } ? R : unknown
  ) => void;
  onClose?: () => void;
};

export type ModalComponent<TProps = unknown, TResult = unknown> = (
  props: TProps & BaseModalProps<TResult>
) => ReactNode | Promise<ReactNode>;

type ModalId = keyof typeof modalRegistry;

type ModalArgs<TId extends ModalId> = Parameters<(typeof modalRegistry)[TId]['component']>[0];

/**
 * Which panel of the stack the surrounding component is rendered in, so that a
 * modal closing or guarding itself acts on its own panel rather than on whatever
 * happens to be on top.
 */
const ModalLayerKeyContext = createContext<number | null>(null);

export function ModalLayerKeyProvider({
  layerKey,
  children,
}: {
  layerKey: number;
  children: ReactNode;
}) {
  return <ModalLayerKeyContext value={layerKey}>{children}</ModalLayerKeyContext>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapArgs<TId extends ModalId>(args: UserArgs<TId>): Record<string, any> {
  return {
    ...args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (result: any) => {
      modalStore.closeModal('completed');
      args.onSuccess?.(result);
    },
    onClose: () => {
      modalStore.closeModal('dismissed');
      args.onClose?.();
    },
  };
}

export function useModalContext() {
  const layerKey = useContext(ModalLayerKeyContext);

  const showModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    modalStore.setModal(id, wrapArgs(args));
  }, []);

  const transitionModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    // Replaces this panel's content in place — the dialog stays open and
    // AnimatedHeight handles the swap — rather than stacking a second panel.
    modalStore.replaceModal(id, wrapArgs(args));
  }, []);

  const closeModal = useCallback(() => {
    if (layerKey === null) modalStore.closeModal('dismissed');
    else modalStore.closeLayer(layerKey);
  }, [layerKey]);

  const setCloseGuard = useCallback(
    (active: boolean) => {
      const key = layerKey ?? modalStore.top?.key;
      if (key === undefined || key === null) return;
      modalStore.setCloseGuard(key, active);
    },
    [layerKey]
  );

  const hasActiveCloseGuard = useMobxValue(() => modalStore.closeGuardActive);

  return { closeModal, showModal, transitionModal, hasActiveCloseGuard, setCloseGuard };
}

export function useShowModal<MId extends ModalId>(id: MId) {
  return useCallback(
    (args: UserArgs<MId>) => {
      modalStore.setModal(id, wrapArgs(args));
    },
    [id]
  );
}

export function useTransitionModal<MId extends ModalId>(id: MId) {
  return useCallback(
    (args: UserArgs<MId>) => {
      modalStore.replaceModal(id, wrapArgs(args));
    },
    [id]
  );
}

/**
 * Standalone (non-hook) alternative to useShowModal.
 * Safe to call from MobX reactions, command providers, and any code outside
 * of the React tree.
 */
export function showModal<TId extends ModalId>(id: TId, args: UserArgs<TId>): void {
  modalStore.setModal(id, wrapArgs(args));
}
