import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { app } from 'electron';
import { APP_NAME_LOWER } from '@shared/app-identity';
import {
  isYodaDeepLinkUrl,
  parseYodaDeepLink,
  type DeepLinkTarget,
  type ParsedDeepLink,
} from '@shared/deep-links';
import { deepLinkOpenChannel } from '@shared/events/appEvents';
import { getMainWindow } from '@main/app/window';
import { conversations, projects, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const DEV_PROTOCOL_REGISTRATION_ENV = 'YODA_REGISTER_DEEP_LINKS';

class DeepLinkService {
  private started = false;
  private rendererReady = false;
  private readonly pendingUrls: string[] = [];
  private readonly pendingTargets: DeepLinkTarget[] = [];

  register(): void {
    this.registerProtocolClient();
    this.enqueueArgv(process.argv);

    app.on('open-url', (event, url) => {
      event.preventDefault();
      this.open(url);
    });
  }

  start(): void {
    this.started = true;
    this.flushPendingUrls();
  }

  markRendererNotReady(): void {
    this.rendererReady = false;
  }

  consumePendingTargets(): DeepLinkTarget[] {
    this.rendererReady = true;
    const targets = [...this.pendingTargets];
    this.pendingTargets.length = 0;
    return targets;
  }

  enqueueArgv(argv: string[]): boolean {
    const urls = argv.filter((arg) => isYodaDeepLinkUrl(arg));
    for (const url of urls) this.open(url);
    return urls.length > 0;
  }

  open(rawUrl: string): void {
    if (!isYodaDeepLinkUrl(rawUrl)) return;
    if (!this.started) {
      this.pendingUrls.push(rawUrl);
      return;
    }

    void this.resolve(rawUrl)
      .then((target) => {
        if (!target) return;
        this.dispatch(target);
      })
      .catch((error: unknown) => {
        log.warn('deep-link: failed to open URL', { rawUrl, error: String(error) });
      });
  }

  private registerProtocolClient(): void {
    if (import.meta.env.DEV && process.env[DEV_PROTOCOL_REGISTRATION_ENV] !== '1') {
      return;
    }

    try {
      const proc = process as NodeJS.Process & { defaultApp?: boolean };
      const ok =
        import.meta.env.DEV && proc.defaultApp && process.argv[1]
          ? app.setAsDefaultProtocolClient(APP_NAME_LOWER, process.execPath, [process.argv[1]])
          : app.setAsDefaultProtocolClient(APP_NAME_LOWER);
      if (!ok)
        log.warn('deep-link: failed to register protocol client', { scheme: APP_NAME_LOWER });
    } catch (error) {
      log.warn('deep-link: failed to register protocol client', {
        scheme: APP_NAME_LOWER,
        error: String(error),
      });
    }
  }

  private flushPendingUrls(): void {
    const urls = this.pendingUrls.splice(0);
    for (const url of urls) this.open(url);
  }

  private async resolve(rawUrl: string): Promise<DeepLinkTarget | null> {
    const parsed = parseYodaDeepLink(rawUrl);
    if (!parsed) {
      log.warn('deep-link: unsupported URL', { rawUrl });
      return null;
    }

    const resolved = await resolveTaskTarget(parsed);
    if (!resolved) {
      log.warn('deep-link: target not found', { rawUrl, parsed });
      return null;
    }

    return {
      id: randomUUID(),
      rawUrl,
      ...resolved,
      ...(parsed.conversationId ? { conversationId: parsed.conversationId } : {}),
      ...(parsed.promptId ? { promptId: parsed.promptId } : {}),
      ...(parsed.promptIndex ? { promptIndex: parsed.promptIndex } : {}),
    };
  }

  private dispatch(target: DeepLinkTarget): void {
    focusMainWindow();

    const win = getMainWindow();
    if (!this.rendererReady || !win || win.isDestroyed()) {
      this.pendingTargets.push(target);
      return;
    }

    events.emit(deepLinkOpenChannel, target);
  }
}

async function resolveTaskTarget(
  parsed: ParsedDeepLink
): Promise<{ projectId: string; taskId?: string } | null> {
  const { db } = await import('@main/db/client');

  if (parsed.conversationId) {
    const [row] = await db
      .select({ projectId: conversations.projectId, taskId: conversations.taskId })
      .from(conversations)
      .where(eq(conversations.id, parsed.conversationId))
      .limit(1);
    return row ?? null;
  }

  if (!parsed.projectId) return null;

  // Project-only target: validate the project exists, no task to resolve.
  if (!parsed.taskId) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, parsed.projectId))
      .limit(1);
    return row ? { projectId: parsed.projectId } : null;
  }

  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, parsed.projectId), eq(tasks.id, parsed.taskId)))
    .limit(1);

  return row ? { projectId: parsed.projectId, taskId: parsed.taskId } : null;
}

function focusMainWindow(): void {
  // Must target the main full-app window, not getAllWindows()[0] — a pre-warmed
  // (hidden, blank) task window can sit at index 0, and showing it surfaces a
  // white screen over the main window. getMainWindow() matches the window the
  // deep-link event is routed to in events.ts.
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

export const deepLinkService = new DeepLinkService();
