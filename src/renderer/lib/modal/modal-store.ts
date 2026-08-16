import { makeAutoObservable, observable } from 'mobx';

export interface ModalLayer {
  /**
   * Identity of one panel on screen. Stable across content swaps so a layer keeps
   * its DOM — and therefore its open/close animation — when it is transitioned to
   * a different modal rather than stacked over.
   */
  key: number;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
}

/**
 * Panels stack: opening a modal from inside a modal puts it on top rather than
 * replacing what is underneath, and closing it falls back to the panel it was
 * opened from. Without this, a modal reached from a modal destroys its own
 * caller — including any local dialog the caller was rendering — and dismissing
 * it leaves nothing behind.
 */
class ModalStore {
  /** Bottom to top; the last entry is the panel the user is interacting with. */
  layers: ModalLayer[] = [];
  /** Popped layers still playing their exit animation. */
  closing: ModalLayer[] = [];
  /** Keys of layers that refuse passive dismissal, e.g. while they hold unsaved edits. */
  guardedKeys: number[] = [];
  private nextKey = 1;

  constructor() {
    makeAutoObservable<ModalStore, 'nextKey'>(this, {
      // Args carry callbacks and React nodes: observe the list, not what is in it.
      layers: observable.shallow,
      closing: observable.shallow,
      guardedKeys: observable.shallow,
      nextKey: false,
    });
  }

  /** Push a panel on top of whatever is already open. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setModal(id: string, args: Record<string, any>) {
    this.layers.push({ key: this.nextKey++, id, args });
  }

  /** Swap the top panel's content in place, keeping it the same panel on screen. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replaceModal(id: string, args: Record<string, any>) {
    const top = this.top;
    if (!top) {
      this.setModal(id, args);
      return;
    }
    this.layers[this.layers.length - 1] = { key: top.key, id, args };
  }

  /** Dismiss the top panel and fall back to the one below it. */
  closeModal(_outcome: 'completed' | 'dismissed' = 'dismissed') {
    const top = this.top;
    if (top) this.closeLayer(top.key);
  }

  /**
   * Dismiss one panel and everything stacked above it. Closing something the user
   * has already covered takes its children with it — leaving them behind would
   * strand panels whose caller is gone.
   */
  closeLayer(key: number) {
    const index = this.layers.findIndex((layer) => layer.key === key);
    if (index === -1) return;
    const removed = this.layers.splice(index);
    const removedKeys = new Set(removed.map((layer) => layer.key));
    this.guardedKeys = this.guardedKeys.filter((guarded) => !removedKeys.has(guarded));
    this.closing.push(...removed);
  }

  /** Dismiss every panel — for a navigation that leaves the surface they belong to. */
  closeAll() {
    if (this.layers.length === 0) return;
    this.closing.push(...this.layers);
    this.layers = [];
    this.guardedKeys = [];
  }

  /** Drop a layer once its exit animation has reported completion. */
  finishClosing(key: number) {
    this.closing = this.closing.filter((layer) => layer.key !== key);
  }

  setCloseGuard(key: number, active: boolean) {
    if (active) {
      if (!this.guardedKeys.includes(key)) this.guardedKeys.push(key);
      return;
    }
    this.guardedKeys = this.guardedKeys.filter((guarded) => guarded !== key);
  }

  get top(): ModalLayer | null {
    return this.layers[this.layers.length - 1] ?? null;
  }

  isTop(key: number): boolean {
    return this.top?.key === key;
  }

  get activeModalId(): string | null {
    return this.top?.id ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get activeModalArgs(): Record<string, any> | null {
    return this.top?.args ?? null;
  }

  get closeGuardActive(): boolean {
    const top = this.top;
    return top !== null && this.guardedKeys.includes(top.key);
  }

  get isOpen(): boolean {
    return this.layers.length > 0;
  }
}

export const modalStore = new ModalStore();
