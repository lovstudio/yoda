import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { type TabViewProvider, type TabViewSnapshot } from '@renderer/lib/stores/generic-tab-view';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import {
  reorderTabIds,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import { log } from '@renderer/utils/logger';
import type { TerminalManagerStore, TerminalStore } from './terminal-manager';

export class TerminalTabViewStore
  implements TabViewProvider<TerminalStore, never>, Snapshottable<TabViewSnapshot>
{
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;

  private readonly resource: TerminalManagerStore;
  private readonly disposers: (() => void)[] = [];
  private disposed = false;

  constructor(resource: TerminalManagerStore) {
    this.resource = resource;
    makeObservable(this, {
      tabOrder: observable,
      activeTabId: observable,
      tabs: computed,
      activeTab: computed,
      snapshot: computed,
      addTab: action,
      removeTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setActiveTab: action,
      restoreSnapshot: action,
    });

    this.disposers.push(
      reaction(
        () => Array.from(this.resource.terminals.keys()),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          // Remove deleted IDs
          for (let i = this.tabOrder.length - 1; i >= 0; i--) {
            if (!idSet.has(this.tabOrder[i])) {
              this.tabOrder.splice(i, 1);
            }
          }
          // Append new IDs
          for (const id of ids) {
            if (!this.tabOrder.includes(id)) {
              this.tabOrder.push(id);
            }
          }
          // Deselect removed active tab
          if (this.activeTabId && !idSet.has(this.activeTabId)) {
            this.activeTabId = this.tabOrder[0];
          }
          // Auto-select first if nothing is active
          if (!this.activeTabId && this.tabOrder.length > 0) {
            this.activeTabId = this.tabOrder[0];
          }
        })
      )
    );
  }

  get tabs(): TerminalStore[] {
    return this.tabOrder
      .map((id) => this.resource.terminals.get(id))
      .filter(Boolean) as TerminalStore[];
  }

  get activeTab(): TerminalStore | undefined {
    return this.activeTabId ? this.resource.terminals.get(this.activeTabId) : undefined;
  }

  get snapshot(): TabViewSnapshot {
    return { tabOrder: this.tabOrder.slice(), activeTabId: this.activeTabId };
  }

  restoreSnapshot(snapshot: Partial<TabViewSnapshot>): void {
    if (snapshot.tabOrder) this.tabOrder = snapshot.tabOrder;
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  setActiveTab(id: string): void {
    setTabActive(this, id);
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    reorderTabIds(this, fromIndex, toIndex);
  }

  setNextTabActive(): void {
    setNextTabActive(this);
  }

  setPreviousTabActive(): void {
    setPreviousTabActive(this);
  }

  setTabActiveIndex(index: number): void {
    setTabActiveIndex(this, index);
  }

  // addTab is required by TabViewProvider but terminals are created explicitly
  addTab(_args: never): void {}

  removeTab(id: string): void {
    if (this.disposed) return;
    void this.removeTabAndEnsureReplacement(id);
  }

  private async removeTabAndEnsureReplacement(id: string): Promise<void> {
    try {
      await this.resource.deleteTerminal(id);
      if (this.disposed) return;
      if (this.resource.terminals.size === 0) {
        await this.resource.ensureDefaultTerminal();
      }
    } catch (error) {
      log.error('Failed to delete or replace terminal:', error);
    }
  }

  closeActiveTab(): void {
    if (this.activeTabId) this.removeTab(this.activeTabId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.disposers) d();
  }
}
