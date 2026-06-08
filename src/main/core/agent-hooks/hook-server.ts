import crypto from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { log } from '@main/lib/logger';

export interface RawHookRequest {
  ptyId: string;
  type: string;
  body: string;
}

export type HookHandler = (raw: RawHookRequest) => Promise<void>;

/**
 * Stable, well-known path where the running hook server publishes its current
 * `{ port, token }`. Agent CLIs read this at hook-fire time instead of relying
 * on a `YODA_HOOK_PORT` env var captured when the PTY was spawned — that env
 * goes stale the moment the main process restarts (common in dev), leaving
 * long-lived agent sessions curling a dead port. `$HOME` is reliable in any
 * child process, so the hook command can locate this file without Yoda's help.
 */
export const HOOK_ENDPOINT_PATH = join(homedir(), '.yoda', 'hook-endpoint.json');

export class HookServer {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';

  async start(handler: HookHandler): Promise<void> {
    if (this.server) return;
    this.token = crypto.randomUUID();

    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.headers['x-yoda-token'] !== this.token) {
        log.warn('HookServer: rejected request with invalid token');
        res.writeHead(403);
        res.end();
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > 1_000_000) {
          req.destroy();
        }
      });

      req.on('end', () => {
        const ptyId = String(req.headers['x-yoda-pty-id'] || '');
        const type = String(req.headers['x-yoda-event-type'] || '');
        if (!ptyId || !type) {
          log.warn('HookServer: malformed request — missing ptyId or type headers');
          res.writeHead(400);
          res.end();
          return;
        }
        handler({ ptyId, type, body })
          .then(() => {
            res.writeHead(200);
            res.end();
          })
          .catch((err) => {
            log.warn('HookServer: handler error', { error: String(err) });
            res.writeHead(500);
            res.end();
          });
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        this.publishEndpoint();
        log.info('HookServer: started', { port: this.port });
        resolve();
      });
      this.server!.on('error', (err) => {
        log.error('HookServer: failed to start', { error: String(err) });
        reject(err);
      });
    });
  }

  /** Write the current `{ port, token }` to the well-known endpoint file. */
  private publishEndpoint(): void {
    try {
      mkdirSync(dirname(HOOK_ENDPOINT_PATH), { recursive: true });
      writeFileSync(HOOK_ENDPOINT_PATH, JSON.stringify({ port: this.port, token: this.token }), {
        mode: 0o600,
      });
    } catch (err) {
      log.warn('HookServer: failed to publish endpoint file', {
        path: HOOK_ENDPOINT_PATH,
        error: String(err),
      });
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
    try {
      rmSync(HOOK_ENDPOINT_PATH, { force: true });
    } catch {}
  }
  getPort(): number {
    return this.port;
  }
  getToken(): string {
    return this.token;
  }
}
