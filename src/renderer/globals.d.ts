declare module 'react-syntax-highlighter';
declare module 'react-syntax-highlighter/dist/esm/styles/prism';

declare global {
  /**
   * Minimal surface of Electron's <webview> tag (webviewTag is enabled in the
   * main window's webPreferences). Kept local so the renderer doesn't depend
   * on Electron's type package.
   */
  interface ElectronWebviewElement extends HTMLElement {
    src: string;
    loadURL(url: string): Promise<void>;
    getURL(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    setAudioMuted(muted: boolean): void;
    isAudioMuted(): boolean;
    isCurrentlyAudible(): boolean;
  }

  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      eventSend: (channel: string, data: unknown) => void;
      eventOn: (channel: string, cb: (data: unknown) => void) => () => void;
      getPathForFile: (file: File) => string;
      getCurrentWindowId: () => Promise<number | null>;
      closeCurrentWindow: () => Promise<void>;
    };
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<ElectronWebviewElement>, ElectronWebviewElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        webpreferences?: string;
      };
    }
  }
}

export {};
