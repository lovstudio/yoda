import { action, makeObservable, observable } from 'mobx';
import type { BrowserHistoryEntry, TaskBrowserSnapshot } from '@shared/view-state';

const HISTORY_LIMIT = 50;

/**
 * Observable state of the task's single resident in-app browser card
 * (Codex-style: one page at a time; the empty new-tab state shows history).
 *
 * The webview owns navigation. External navigate requests (smart URL clicks,
 * history items, the address bar) bump `navigationId` so the mounted pane
 * loads the URL imperatively; `did-navigate` reports back via `setLocation`.
 */
export class TaskBrowserStore {
  /** Current page; null = the empty new-tab (history) state. */
  url: string | null = null;
  title = '';
  /** Visited pages, most recent first, deduped by URL. */
  history: BrowserHistoryEntry[] = [];
  /** Bumped on every external navigate request; the pane reacts to it. */
  navigationId = 0;
  /** Whether the page is currently emitting sound (mirrored from the webview). */
  audible = false;
  /** User-toggled mute for this browser card; sticky across navigations. */
  userMuted = false;

  constructor(snapshot?: TaskBrowserSnapshot) {
    if (snapshot) {
      this.url = typeof snapshot.url === 'string' ? snapshot.url : null;
      this.title = snapshot.title ?? '';
      this.history = (snapshot.history ?? []).filter((entry) => typeof entry.url === 'string');
    }
    makeObservable(this, {
      url: observable,
      title: observable,
      history: observable,
      navigationId: observable,
      audible: observable,
      userMuted: observable,
      navigate: action,
      openNewTab: action,
      setLocation: action,
      setTitle: action,
      removeFromHistory: action,
      setAudible: action,
      setUserMuted: action,
    });
  }

  get snapshot(): TaskBrowserSnapshot {
    return {
      url: this.url,
      title: this.title,
      history: this.history.map((entry) => ({ ...entry })),
    };
  }

  /** External navigate request — the pane loads it into the webview. */
  navigate(url: string): void {
    this.url = url;
    this.title = '';
    this.navigationId += 1;
    this._recordVisit(url);
  }

  /** Back to the empty state: address bar + history list. */
  openNewTab(): void {
    this.url = null;
    this.title = '';
    this.audible = false;
  }

  /** Mirrored from the webview's media-started-playing / media-paused. */
  setAudible(value: boolean): void {
    this.audible = value;
  }

  /** Toggle the user's mute for this browser card. */
  setUserMuted(value: boolean): void {
    this.userMuted = value;
  }

  /** Remove a single entry from the visit history. */
  removeFromHistory(url: string): void {
    const index = this.history.findIndex((entry) => entry.url === url);
    if (index !== -1) this.history.splice(index, 1);
  }

  /** Reported by the webview on did-navigate. */
  setLocation(url: string): void {
    this.url = url;
    this._recordVisit(url);
  }

  /** Reported by the webview on page-title-updated. */
  setTitle(title: string): void {
    this.title = title;
    const entry = this.history.find((item) => item.url === this.url);
    if (entry) entry.title = title;
  }

  private _recordVisit(url: string): void {
    const existing = this.history.findIndex((entry) => entry.url === url);
    const title = existing === -1 ? '' : this.history[existing].title;
    if (existing !== -1) this.history.splice(existing, 1);
    this.history.unshift({ url, title });
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
  }
}
