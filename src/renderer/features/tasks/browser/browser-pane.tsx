import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Plus,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskBrowserStore } from '@renderer/features/tasks/browser/browser-store';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

/** Normalize address-bar input to a loadable URL (bare hosts get https://). */
function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-muted',
        disabled
          ? 'opacity-40'
          : 'hover:bg-background-2 hover:text-foreground [-webkit-app-region:no-drag]'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The task's resident in-app browser card (Codex-style): one page at a time;
 * the empty new-tab state shows the visit history. The webview owns
 * navigation and mirrors location/title back into the store.
 */
export const BrowserPane = observer(function BrowserPane({
  store,
  visible = true,
}: {
  store: TaskBrowserStore;
  /** Whether this pane is the foreground sidebar view; hidden panes are muted. */
  visible?: boolean;
}) {
  const { t } = useTranslation();
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  /**
   * The `src` the webview mounts with — constant for the lifetime of the
   * mounted webview (a changing `src` prop would reload the page). Later
   * navigation goes through loadURL below.
   */
  const mountSrcRef = useRef<string | null>(null);
  /** The URL the webview was last told to load (or reported via did-navigate). */
  const loadedUrlRef = useRef<string | null>(null);
  const isEmpty = store.url === null;
  if (isEmpty) {
    mountSrcRef.current = null;
    loadedUrlRef.current = null;
  } else if (mountSrcRef.current === null) {
    mountSrcRef.current = store.url;
    loadedUrlRef.current = store.url;
  }

  // External navigate requests (smart URL clicks, history items) while the
  // webview is already mounted: load imperatively.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || store.url === null) return;
    if (loadedUrlRef.current !== store.url) {
      loadedUrlRef.current = store.url;
      void webview.loadURL(store.url);
    }
    // navigationId is the signal; store.url is read at fire time.
  }, [store, store.navigationId, store.url]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const handleNavigate = () => {
      loadedUrlRef.current = webview.getURL();
      store.setLocation(webview.getURL());
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };
    const handleTitle = (event: Event) => {
      const { title } = event as Event & { title?: string };
      if (title) store.setTitle(title);
    };
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('page-title-updated', handleTitle);
    return () => {
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('page-title-updated', handleTitle);
    };
    // Re-attach when the webview (re)mounts after the empty state.
  }, [store, isEmpty]);

  // Mirror the page's audibility into the store so the toolbar (and the owning
  // sidebar tab) can show a speaker indicator.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || isEmpty) {
      store.setAudible(false);
      return;
    }
    const sync = () => store.setAudible(webview.isCurrentlyAudible());
    webview.addEventListener('media-started-playing', sync);
    webview.addEventListener('media-paused', sync);
    return () => {
      webview.removeEventListener('media-started-playing', sync);
      webview.removeEventListener('media-paused', sync);
    };
  }, [store, isEmpty]);

  // Only the foreground browser pane is allowed to make sound: mute when the
  // pane is hidden (another sidebar group active) or the user muted it.
  const effectiveMuted = !visible || store.userMuted;
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || isEmpty) return;
    const apply = () => {
      try {
        webview.setAudioMuted(effectiveMuted);
      } catch {
        // webview not yet attached; the dom-ready listener will retry.
      }
    };
    apply();
    webview.addEventListener('dom-ready', apply);
    return () => webview.removeEventListener('dom-ready', apply);
  }, [effectiveMuted, isEmpty]);

  const submitAddress = () => {
    const url = draftAddress === null ? null : normalizeAddress(draftAddress);
    setDraftAddress(null);
    if (url) store.navigate(url);
  };

  const addressBar = (
    <input
      value={draftAddress ?? store.url ?? ''}
      spellCheck={false}
      placeholder={t('tasks.browser.addressPlaceholder')}
      aria-label={t('tasks.browser.address')}
      className="h-6 min-w-0 flex-1 rounded-md border border-transparent bg-background-2 px-2 font-mono text-xs text-foreground-muted outline-none placeholder:font-sans focus:border-border focus:text-foreground [-webkit-app-region:no-drag]"
      onChange={(event) => setDraftAddress(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submitAddress();
        if (event.key === 'Escape') setDraftAddress(null);
      }}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => setDraftAddress(null)}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background-secondary px-1.5">
        <ToolbarButton
          label={t('tasks.browser.back')}
          disabled={isEmpty || !canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label={t('tasks.browser.forward')}
          disabled={isEmpty || !canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label={t('tasks.browser.reload')}
          disabled={isEmpty}
          onClick={() => webviewRef.current?.reload()}
        >
          <RotateCw className="size-3.5" />
        </ToolbarButton>
        {addressBar}
        {!isEmpty && (store.audible || store.userMuted) && (
          <ToolbarButton
            label={store.userMuted ? t('tasks.browser.unmute') : t('tasks.browser.mute')}
            onClick={() => store.setUserMuted(!store.userMuted)}
          >
            {store.userMuted ? (
              <VolumeX className="size-3.5 text-foreground-muted" />
            ) : (
              <Volume2 className="size-3.5 text-primary" />
            )}
          </ToolbarButton>
        )}
        <ToolbarButton
          label={t('tasks.browser.newTab')}
          disabled={isEmpty}
          onClick={() => store.openNewTab()}
        >
          <Plus className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label={t('tasks.browser.openExternal')}
          disabled={isEmpty}
          onClick={() => {
            if (store.url) void rpc.app.openExternal(store.url);
          }}
        >
          <ExternalLink className="size-3.5" />
        </ToolbarButton>
      </div>
      {isEmpty ? (
        <BrowserHistoryList store={store} />
      ) : (
        <webview ref={webviewRef} src={mountSrcRef.current!} className="min-h-0 w-full flex-1" />
      )}
    </div>
  );
});

/** The empty new-tab state: previously visited pages, most recent first. */
const BrowserHistoryList = observer(function BrowserHistoryList({
  store,
}: {
  store: TaskBrowserStore;
}) {
  const { t } = useTranslation();

  if (store.history.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-foreground-passive">
        <Globe className="size-5" />
        <p className="text-xs">{t('tasks.browser.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-widest text-foreground-passive">
        {t('tasks.browser.recent')}
      </p>
      <div className="flex flex-col gap-1.5">
        {store.history.map((entry) => (
          <div
            key={entry.url}
            role="button"
            tabIndex={0}
            title={entry.url}
            className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background-1 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-background-2"
            onClick={() => store.navigate(entry.url)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') store.navigate(entry.url);
            }}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background-2 text-foreground-muted">
              <Globe className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium text-foreground">
                {entry.title || hostOf(entry.url)}
              </span>
              <span className="truncate font-mono text-[11px] leading-4 text-foreground-passive">
                {entry.url}
              </span>
            </span>
            <button
              type="button"
              aria-label={t('tasks.browser.removeFromHistory')}
              title={t('tasks.browser.removeFromHistory')}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-passive opacity-0 transition-opacity hover:bg-background-3 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                store.removeFromHistory(entry.url);
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
