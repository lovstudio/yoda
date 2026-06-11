import { action, makeObservable, observable, toJS } from 'mobx';
import type { AppSidePaneSnapshot, SidePanePinSnapshot } from '@shared/view-state';
import type { ViewId } from '@renderer/app/view-registry';
import { routeKey } from './app-tabs-store';
import type { Snapshottable } from './snapshottable';

/**
 * A pin in the shell-level side pane.
 *
 * - `view` pins host an arbitrary registered view (settings, project pages,
 *   project files, …) by route. Copy semantics: the top-level tab stays put;
 *   the pane renders an independent instance with its own params.
 * - `task` pins host a task entity (conversation / file / diff / overview).
 *   The entity itself lives in that task's TabManagerStore (`shellPinTabIds`
 *   for moved entries, the fixed overview entry for overview pins) — this
 *   store only references it, mirroring the task-sidebar pin model.
 */
export type SidePanePin =
  | { id: string; kind: 'view'; viewId: ViewId; params: Record<string, unknown> }
  | { id: string; kind: 'task'; projectId: string; taskId: string; tabId: string };

/**
 * Shell-level (cross-route) side pane: a first-class workspace column to the
 * right of the main panel. Navigating the main area — other tasks, settings,
 * project pages — never unmounts it, so pinned sessions keep running and
 * pinned views stay visible. Complements the route-scoped task sidebar.
 */
export class AppSidePaneStore implements Snapshottable<AppSidePaneSnapshot> {
  pins: SidePanePin[] = [];
  activePinId: string | null = null;

  constructor() {
    makeObservable(this, {
      pins: observable,
      activePinId: observable,
      pinView: action,
      pinTask: action,
      unpin: action,
      setActivePin: action,
      updatePinParams: action,
      restoreSnapshot: action,
    });
  }

  get isVisible(): boolean {
    return this.pins.length > 0;
  }

  get activePin(): SidePanePin | undefined {
    return this.pins.find((pin) => pin.id === this.activePinId);
  }

  /** Pin a view route (deduplicated by route identity) and select it. */
  pinView(viewId: ViewId, params: Record<string, unknown>): void {
    const key = routeKey(viewId, params);
    const existing = this.pins.find(
      (pin) => pin.kind === 'view' && routeKey(pin.viewId, pin.params) === key
    );
    if (existing) {
      this.activePinId = existing.id;
      return;
    }
    const pin: SidePanePin = {
      id: crypto.randomUUID(),
      kind: 'view',
      viewId,
      params: toJS(params),
    };
    this.pins.push(pin);
    this.activePinId = pin.id;
  }

  /** Pin a task entity by its internal tab id (deduplicated) and select it. */
  pinTask(projectId: string, taskId: string, tabId: string): void {
    const existing = this.pins.find(
      (pin) =>
        pin.kind === 'task' &&
        pin.projectId === projectId &&
        pin.taskId === taskId &&
        pin.tabId === tabId
    );
    if (existing) {
      this.activePinId = existing.id;
      return;
    }
    const pin: SidePanePin = { id: crypto.randomUUID(), kind: 'task', projectId, taskId, tabId };
    this.pins.push(pin);
    this.activePinId = pin.id;
  }

  /** Remove a pin, falling selection to its neighbor so the pane doesn't blank. */
  unpin(pinId: string): void {
    const idx = this.pins.findIndex((pin) => pin.id === pinId);
    if (idx === -1) return;
    this.pins.splice(idx, 1);
    if (this.activePinId === pinId) {
      this.activePinId = this.pins[idx]?.id ?? this.pins[idx - 1]?.id ?? null;
    }
  }

  setActivePin(pinId: string): void {
    if (this.pins.some((pin) => pin.id === pinId)) this.activePinId = pinId;
  }

  /** Address-bar updates from a pinned view (the override layer's setParams). */
  updatePinParams(pinId: string, params: Record<string, unknown>): void {
    const pin = this.pins.find((entry) => entry.id === pinId);
    if (pin?.kind === 'view') pin.params = toJS(params);
  }

  get snapshot(): AppSidePaneSnapshot {
    return { pins: toJS(this.pins), activePinId: this.activePinId };
  }

  restoreSnapshot(snapshot: Partial<AppSidePaneSnapshot>): void {
    if (!Array.isArray(snapshot.pins)) return;
    const restored = snapshot.pins.filter(isValidPinSnapshot).map((pin) => toJS(pin));
    this.pins = restored as SidePanePin[];
    this.activePinId = restored.some((pin) => pin.id === snapshot.activePinId)
      ? (snapshot.activePinId ?? null)
      : (restored[0]?.id ?? null);
  }
}

function isValidPinSnapshot(pin: SidePanePinSnapshot | undefined): pin is SidePanePinSnapshot {
  if (!pin || typeof pin.id !== 'string') return false;
  if (pin.kind === 'view') {
    return typeof pin.viewId === 'string' && typeof pin.params === 'object' && pin.params !== null;
  }
  if (pin.kind === 'task') {
    return (
      typeof pin.projectId === 'string' &&
      typeof pin.taskId === 'string' &&
      typeof pin.tabId === 'string'
    );
  }
  return false;
}
