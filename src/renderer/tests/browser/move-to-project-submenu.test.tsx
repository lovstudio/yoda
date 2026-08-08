import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MoveToProjectContextSubmenu,
  MoveToProjectDropdownSubmenu,
} from '@renderer/features/tasks/components/move-to-project-submenu';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  sidebarStore: {
    orderedProjects: [] as Array<{
      id: string;
      state: string;
      data: object | null;
      displayName: string;
    }>,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  sidebarStore: mocks.sidebarStore,
}));

vi.mock('@renderer/lib/ui/context-menu', async () => {
  const { createElement: create } = await import('react');
  const container =
    (slot: string) =>
    ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
      create('div', { 'data-slot': slot, ...props }, children);
  const item = ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    create('button', { 'data-slot': 'context-menu-item', ...props }, children);

  return {
    ContextMenuItem: item,
    ContextMenuSeparator: () => create('hr'),
    ContextMenuSub: container('context-menu-sub'),
    ContextMenuSubContent: container('context-menu-sub-content'),
    ContextMenuSubTrigger: item,
  };
});

vi.mock('@renderer/lib/ui/dropdown-menu', async () => {
  const { createElement: create } = await import('react');
  const container =
    (slot: string) =>
    ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
      create('div', { 'data-slot': slot, ...props }, children);
  const item = ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    create('button', { 'data-slot': 'dropdown-menu-item', ...props }, children);

  return {
    DropdownMenuItem: item,
    DropdownMenuSeparator: () => create('hr'),
    DropdownMenuSub: container('dropdown-menu-sub'),
    DropdownMenuSubContent: container('dropdown-menu-sub-content'),
    DropdownMenuSubTrigger: item,
  };
});

function project(id: string, displayName: string) {
  return { id, state: 'ready', data: {}, displayName };
}

function setProjects(projects: Array<{ id: string; displayName: string }>): void {
  mocks.sidebarStore.orderedProjects = projects.map(({ id, displayName }) =>
    project(id, displayName)
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) throw new Error('HTMLInputElement value setter is missing');
  valueSetter.call(input, value);
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })
  );
}

describe('move-to-project submenu', () => {
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
    vi.clearAllMocks();
  });

  it('offers project creation when there are no other projects', async () => {
    setProjects([{ id: 'current', displayName: 'Current project' }]);
    const onMove = vi.fn();
    const onCreateProject = vi.fn();

    await act(async () => {
      root.render(
        createElement(MoveToProjectContextSubmenu, {
          currentProjectId: 'current',
          onMove,
          onCreateProject,
          showSeparator: false,
        })
      );
    });

    const createItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-slot="context-menu-item"]')
    ).find((item) => item.textContent?.includes('tasks.context.moveToProjectCreate'));
    expect(createItem).toBeDefined();
    expect(document.body.textContent).not.toContain('tasks.context.moveToProjectEmpty');

    await act(async () => createItem?.click());

    expect(onCreateProject).toHaveBeenCalledWith(undefined);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('passes a missing search result to project creation', async () => {
    setProjects([
      { id: 'current', displayName: 'Current project' },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `project-${index}`,
        displayName: `Project ${index}`,
      })),
    ]);
    const onCreateProject = vi.fn();

    await act(async () => {
      root.render(
        createElement(MoveToProjectDropdownSubmenu, {
          currentProjectId: 'current',
          onMove: vi.fn(),
          onCreateProject,
          showSeparator: false,
        })
      );
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="tasks.context.moveToProjectSearch"]'
    );
    expect(input).toBeDefined();

    await act(async () => {
      setInputValue(input!, 'New project');
    });

    const createItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes('tasks.context.moveToProjectCreateNamed'));
    expect(createItem?.textContent).toContain('New project');

    await act(async () => createItem?.click());

    expect(onCreateProject).toHaveBeenCalledWith('New project');
  });
});
