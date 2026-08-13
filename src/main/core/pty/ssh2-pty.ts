import { StringDecoder } from 'node:string_decoder';
import type { Client, ClientChannel } from 'ssh2';
import { err, ok, type Result } from '@shared/result';
import { log } from '@main/lib/logger';
import { normalizeSignal } from './exit-signals';
import type { Pty, PtyDimensions, PtyExitInfo } from './pty';

export type Ssh2OpenError = {
  readonly kind: 'channel-open-failed';
  readonly message: string;
};

export interface Ssh2SpawnOptions extends PtyDimensions {
  id: string;
  command: string;
}

export class Ssh2PtySession implements Pty {
  readonly id: string;
  private readonly decoder = new StringDecoder('utf8');
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  private bufferedData: string[] = [];
  private bufferedExit: PtyExitInfo | null = null;
  private decoderFinished = false;
  private dataReplayComplete = false;
  private exitReplayComplete = false;
  private replayScheduled = false;

  constructor(
    id: string,
    private readonly channel: ClientChannel
  ) {
    this.id = id;
    // Install transport listeners before openSsh2Pty resolves. ssh2 can parse
    // CHANNEL_SUCCESS, DATA, and CLOSE from one network read; listeners added
    // only after the caller's await continuation would miss that early close.
    this.channel.on('data', this.handleChannelData);
    this.channel.once('end', this.handleChannelEnd);
    this.channel.once('close', this.handleChannelClose);
  }

  write(data: string): void {
    this.channel.write(data);
  }

  resize(cols: number, rows: number): boolean {
    try {
      this.channel.setWindow(rows, cols, 0, 0);
      return true;
    } catch (err: unknown) {
      log.warn('Ssh2PtySession:resize failed', {
        cols,
        rows,
        error: String((err as Error)?.message ?? err),
      });
      return false;
    }
  }

  pause(): void {
    this.channel.pause();
  }

  resume(): void {
    this.channel.resume();
  }

  kill(): void {
    try {
      this.channel.close();
    } catch {}
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
    if (this.dataReplayComplete) return;
    if (this.bufferedData.length === 0) {
      // No pre-subscription data exists, so preserve synchronous delivery for
      // the normal live path.
      this.dataReplayComplete = true;
      return;
    }
    this.scheduleBufferedReplay();
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
    if (this.bufferedExit) this.scheduleBufferedReplay();
  }

  private readonly handleChannelData = (chunk: Buffer): void => {
    if (this.decoderFinished) return;
    this.acceptData(this.decoder.write(chunk));
  };

  private readonly handleChannelEnd = (): void => {
    this.finishDecoder();
  };

  private readonly handleChannelClose = (exitCode: number | null, signal: string | null): void => {
    this.finishDecoder();
    this.acceptExit({
      exitCode: exitCode ?? undefined,
      signal: normalizeSignal(signal),
    });
  };

  private finishDecoder(): void {
    if (this.decoderFinished) return;
    this.decoderFinished = true;
    this.channel.off('data', this.handleChannelData);
    this.channel.off('end', this.handleChannelEnd);
    this.acceptData(this.decoder.end());
  }

  private acceptData(data: string): void {
    if (!data) return;
    if (!this.dataReplayComplete) {
      this.bufferedData.push(data);
      return;
    }
    for (const handler of [...this.dataHandlers]) handler(data);
  }

  private acceptExit(info: PtyExitInfo): void {
    if (this.exitReplayComplete || this.bufferedExit) return;
    if (this.exitHandlers.length === 0 || !this.dataReplayComplete) {
      this.bufferedExit = info;
      return;
    }
    this.exitReplayComplete = true;
    for (const handler of [...this.exitHandlers]) handler(info);
  }

  private scheduleBufferedReplay(): void {
    if (this.replayScheduled) return;
    this.replayScheduled = true;
    queueMicrotask(() => {
      this.replayScheduled = false;

      // The microtask lets every listener wired synchronously by the provider
      // and registry join the first cohort. Replay decoded output before exit
      // so a short-lived command preserves the same data → close ordering.
      if (!this.dataReplayComplete && this.dataHandlers.length > 0) {
        const bufferedData = this.bufferedData;
        this.bufferedData = [];
        this.dataReplayComplete = true;
        for (const data of bufferedData) {
          for (const handler of [...this.dataHandlers]) handler(data);
        }
      }

      if (this.bufferedExit && this.exitHandlers.length > 0) {
        const bufferedExit = this.bufferedExit;
        this.bufferedExit = null;
        this.exitReplayComplete = true;
        for (const handler of [...this.exitHandlers]) handler(bufferedExit);
      }
    });
  }
}

export async function openSsh2Pty(
  sshClient: Client,
  options: Ssh2SpawnOptions
): Promise<Result<Ssh2PtySession, Ssh2OpenError>> {
  const { id, command, cols, rows } = options;
  return new Promise((resolve) => {
    sshClient.exec(
      command,
      {
        pty: {
          term: 'xterm-256color',
          cols,
          rows,
          // width/height in pixels — set to 0, terminal uses cols/rows instead
          width: 0,
          height: 0,
        },
      },
      (e, channel) => {
        if (e) {
          const message = e instanceof Error ? e.message : String(e);
          return resolve(err({ kind: 'channel-open-failed', message }));
        }
        resolve(ok(new Ssh2PtySession(id, channel)));
      }
    );
  });
}
