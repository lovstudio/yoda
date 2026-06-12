import { action, observable } from 'mobx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskWindowTabTarget } from '@shared/task-window';
import type { BottomPanelTab } from '@shared/view-state';
import type { SidebarTabGroup } from '@renderer/features/tasks/types';
import type { AppTabEntry } from '@renderer/lib/stores/app-tabs-store';

/**
 * Cross-area tab dragging (top strip ↔ task sidebar strip ↔ shell side pane),
 * built on pointer events — NOT HTML5 drag-and-drop. The OS drag loop that
 * HTML5 DnD enters on macOS doesn't reliably deliver dragover/drop inside this
 * frameless window (titlebar `-webkit-app-region: drag` interplay), while
 * pointer-driven dragging — the same model dnd-kit uses for the kanban board —
 * works everywhere. The strips live in unrelated React subtrees, so a
 * module-level payload + drop-zone registry replaces a common DnD context.
 * Each strip declares what it accepts and performs the move with the same
 * store methods its context menu uses.
 */
export type TabDragPayload =
  | {
      kind: 'task-entity';
      from: 'strip' | 'taskSidebar' | 'shellPane';
      projectId: string;
      taskId: string;
      /** Always a non-overview target — the overview tab never moves. */
      target: TaskWindowTabTarget;
      /** Top-level tab entry when dragged from the strip (closed after the move). */
      appTab?: AppTabEntry;
      /** Internal TabManagerStore id when dragged from the task sidebar or shell pane. */
      tabId?: string;
      /** Shell pane pin id when dragged from there. */
      pinId?: string;
    }
  /** Any non-entity top-level tab — copy-pinned into the shell pane on drop. */
  | { kind: 'view'; from: 'strip'; appTab: AppTabEntry }
  /** A copy-semantics shell pin (view / overview) — reorders within the pane only. */
  | { kind: 'shell-pin'; pinId: string }
  /** A task-sidebar feature card — reorders within the sidebar strip only. */
  | { kind: 'sidebar-group'; group: SidebarTabGroup }
  /** A bottom-panel mode tab — reorders within the bottom strip only. */
  | { kind: 'bottom-mode'; mode: BottomPanelTab }
  /** A terminal row in the bottom drawer's list — reorders within it only. */
  | { kind: 'terminal-item'; terminalId: string };

/** What a drop handler receives: the zone element plus the pointer position. */
export type TabDropEvent = { currentTarget: HTMLElement; clientX: number; clientY: number };

export type TabDragSourceProps = { onMouseDown: React.MouseEventHandler<HTMLElement> };

type DropZone = {
  node: HTMLElement;
  canDrop: (payload: TabDragPayload) => boolean;
  onDrop: (payload: TabDragPayload, event: TabDropEvent) => void;
  setIsOver: (over: boolean) => void;
};

const zones = new Set<DropZone>();

/** Movement (px) from mousedown before the gesture becomes a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;

/** Observable so observer components can react while a drag runs. */
const currentDrag = observable.box<TabDragPayload | null>(null, { deep: false });
const setCurrentDrag = action((payload: TabDragPayload | null) => currentDrag.set(payload));

/** The payload of the in-flight tab drag, if any. Observable. */
export function activeTabDrag(): TabDragPayload | null {
  return currentDrag.get();
}

let pending: { payload: () => TabDragPayload; x: number; y: number; source: HTMLElement } | null =
  null;
let active: { payload: TabDragPayload; ghost: HTMLElement; over: DropZone | null } | null = null;

/** Drag-source DOM props for a chip/tab. The payload is built lazily at drag start. */
export function tabDragSource(payload: () => TabDragPayload): TabDragSourceProps {
  return {
    onMouseDown: (event) => {
      if (event.button !== 0) return;
      // The chip's close (×) button must keep its plain click behavior.
      if ((event.target as HTMLElement).closest('button')) return;
      pending = {
        payload,
        x: event.clientX,
        y: event.clientY,
        source: event.currentTarget as HTMLElement,
      };
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('keydown', onKeyDown, true);
    },
  };
}

function onMouseMove(event: MouseEvent): void {
  if (pending && !active) {
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < DRAG_THRESHOLD_PX) {
      return;
    }
    beginDrag();
  }
  if (!active) return;
  event.preventDefault();
  positionGhost(active.ghost, event);
  updateOver(event);
}

function beginDrag(): void {
  if (!pending) return;
  const ghost = buildGhost(pending.source);
  active = { payload: pending.payload(), ghost, over: null };
  setCurrentDrag(active.payload);
  document.body.style.cursor = 'grabbing';
}

/**
 * Highlight the zone under the pointer that accepts the payload, if any.
 * Zones can nest (a strip inside the workspace column) — the innermost
 * matching zone wins so precise targets keep priority over broad ones.
 */
function updateOver(event: MouseEvent): void {
  if (!active) return;
  const el = document.elementFromPoint(event.clientX, event.clientY);
  let next: DropZone | null = null;
  if (el) {
    for (const zone of zones) {
      if (!zone.node.contains(el) || !zone.canDrop(active.payload)) continue;
      if (!next || next.node.contains(zone.node)) next = zone;
    }
  }
  if (active.over === next) return;
  active.over?.setIsOver(false);
  next?.setIsOver(true);
  active.over = next;
}

function onMouseUp(event: MouseEvent): void {
  const finished = active;
  if (finished) {
    event.preventDefault();
    event.stopPropagation();
    suppressNextClick();
  }
  endDrag();
  if (finished?.over) {
    finished.over.onDrop(finished.payload, {
      currentTarget: finished.over.node,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') endDrag();
}

function endDrag(): void {
  window.removeEventListener('mousemove', onMouseMove, true);
  window.removeEventListener('mouseup', onMouseUp, true);
  window.removeEventListener('keydown', onKeyDown, true);
  active?.over?.setIsOver(false);
  active?.ghost.remove();
  document.body.style.cursor = '';
  pending = null;
  active = null;
  setCurrentDrag(null);
}

/**
 * A completed drag's mouseup still dispatches a click at the common ancestor —
 * swallow that one so dropping never doubles as selecting. The browser fires
 * it synchronously after mouseup, so a 0-timeout safely retires the guard when
 * no click materializes.
 */
function suppressNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

/** Semi-transparent clone of the dragged chip, following the pointer. */
function buildGhost(source: HTMLElement): HTMLElement {
  const ghost = source.cloneNode(true) as HTMLElement;
  const rect = source.getBoundingClientRect();
  ghost.style.position = 'fixed';
  ghost.style.left = '0';
  ghost.style.top = '0';
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.7';
  ghost.style.zIndex = '9999';
  ghost.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  document.body.appendChild(ghost);
  return ghost;
}

function positionGhost(ghost: HTMLElement, event: MouseEvent): void {
  ghost.style.transform = `translate(${event.clientX + 8}px, ${event.clientY + 8}px)`;
}

/**
 * Registers a strip container as a drop zone. `canDrop` gates the hover
 * highlight and the drop; `onDrop` performs the move (use `tabDropIndex` for
 * the insertion position among the container's marked chips). Attach the
 * returned `dropRef` to the container element.
 */
export function useTabDropZone({
  canDrop,
  onDrop,
}: {
  canDrop: (payload: TabDragPayload) => boolean;
  onDrop: (payload: TabDragPayload, event: TabDropEvent) => void;
}): { isOver: boolean; dropRef: (node: HTMLElement | null) => void } {
  const [isOver, setIsOver] = useState(false);
  // Latest-handler refs so the registered zone never goes stale.
  const handlers = useRef({ canDrop, onDrop });
  useEffect(() => {
    handlers.current = { canDrop, onDrop };
  });
  const zoneRef = useRef<DropZone | null>(null);

  const dropRef = useCallback((node: HTMLElement | null) => {
    if (zoneRef.current) {
      zones.delete(zoneRef.current);
      zoneRef.current = null;
    }
    if (node) {
      zoneRef.current = {
        node,
        canDrop: (payload) => handlers.current.canDrop(payload),
        onDrop: (payload, event) => handlers.current.onDrop(payload, event),
        setIsOver,
      };
      zones.add(zoneRef.current);
    }
  }, []);

  return { isOver, dropRef };
}

/**
 * Raw insertion index at the pointer among the zone's chips carrying
 * `data-tab-drop-marker={marker}` — computed BEFORE any removal, so reorder
 * methods must adjust when the dragged item precedes the index. Pass `'y'`
 * for vertical lists (e.g. the bottom drawer's terminal rows).
 */
export function tabDropIndex(event: TabDropEvent, marker: string, axis: 'x' | 'y' = 'x'): number {
  const chips = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(`[data-tab-drop-marker="${marker}"]`)
  );
  for (let i = 0; i < chips.length; i++) {
    const rect = chips[i].getBoundingClientRect();
    const past =
      axis === 'x'
        ? event.clientX < rect.left + rect.width / 2
        : event.clientY < rect.top + rect.height / 2;
    if (past) return i;
  }
  return chips.length;
}
