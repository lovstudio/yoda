export type PtyExitInfo = {
  exitCode?: number;
  signal?: number | string;
};

export interface PtyDimensions {
  cols: number;
  rows: number;
}

export interface Pty {
  /** OS process id when the PTY is local and exposes one. */
  readonly pid?: number;
  write(data: string): void;
  /** Returns false when the underlying PTY rejected the new grid. */
  resize(cols: number, rows: number): void | boolean;
  /** Temporarily stop/resume output reads for renderer flow control. */
  pause(): void;
  resume(): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (info: PtyExitInfo) => void): void;
}
