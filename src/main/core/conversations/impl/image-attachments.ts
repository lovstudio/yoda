import { clipboard, nativeImage, type NativeImage } from 'electron';
import {
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
} from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';

const CTRL_V = '\x16';
/** TUI is considered booted once output has gone quiet for this long. */
const TUI_READY_QUIET_MS = 700;
const TUI_READY_TIMEOUT_MS = 10_000;
/** Time the TUI gets to read the clipboard before it is overwritten/restored. */
const IMAGE_PASTE_DELAY_MS = 500;
/** Pause after a text chunk so the TUI finishes ingesting the paste before the
 *  next input — a Ctrl+V coalesced into the same stdin chunk as a bracketed
 *  paste gets swallowed by the paste parser. */
const TEXT_SEGMENT_DELAY_MS = 250;
const PROMPT_SUBMIT_DELAY_MS = 150;
/** Grace period after submit before the user's clipboard is restored, in case
 *  the TUI reads the clipboard asynchronously. */
const CLIPBOARD_RESTORE_DELAY_MS = 500;

/** `{{yoda-image:N}}` marks where imagePaths[N] belongs inside the prompt. */
const IMAGE_MARKER_RE = /\{\{yoda-image:(\d+)\}\}/g;

type PromptSegment = { type: 'text'; text: string } | { type: 'image'; path: string };

/** Split a marker-bearing prompt into ordered text/image segments. Image paths
 *  never referenced by a marker are appended at the end (defensive). */
function splitPromptByImageMarkers(prompt: string, imagePaths: string[]): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const used = new Set<number>();
  let cursor = 0;
  for (const match of prompt.matchAll(IMAGE_MARKER_RE)) {
    const index = Number(match[1]);
    const path = imagePaths[index];
    if (!path) continue;
    if (match.index > cursor)
      segments.push({ type: 'text', text: prompt.slice(cursor, match.index) });
    segments.push({ type: 'image', path });
    used.add(index);
    cursor = match.index + match[0].length;
  }
  if (cursor < prompt.length) segments.push({ type: 'text', text: prompt.slice(cursor) });
  for (const [index, path] of imagePaths.entries()) {
    if (!used.has(index)) segments.push({ type: 'image', path });
  }
  return segments;
}

/**
 * Fallback transport for runtimes without clipboard paste: substitute each
 * `{{yoda-image:N}}` marker with an `@path` mention in place (ordering is
 * preserved); unreferenced paths are appended. Every CLI resolves file paths
 * from the message text, so this works universally (just without the native
 * image rendering in the TUI).
 */
export function substituteImageMentions(
  prompt: string | undefined,
  imagePaths: string[]
): string | undefined {
  if (imagePaths.length === 0) return prompt;
  const used = new Set<number>();
  const substituted = (prompt ?? '').replace(IMAGE_MARKER_RE, (match, rawIndex: string) => {
    const index = Number(rawIndex);
    const path = imagePaths[index];
    if (!path) return match;
    used.add(index);
    return `@${path}`;
  });
  const leftovers = imagePaths.filter((_, index) => !used.has(index)).map((path) => `@${path}`);
  if (leftovers.length === 0) return substituted || undefined;
  const trimmed = substituted.trim();
  return trimmed ? `${trimmed}\n\n${leftovers.join('\n')}` : leftovers.join('\n');
}

/**
 * Deliver the prompt the way a user would type it: wait for the TUI to boot,
 * then walk the prompt segments in order — text chunks are bracketed-paste
 * injected, `{{yoda-image:N}}` markers become native clipboard pastes (write
 * the image to the OS clipboard, send Ctrl+V; the CLI reads the clipboard
 * itself and renders its image placeholder in place). Images that cannot be
 * decoded (e.g. SVG) degrade to an inline `@path` mention at the same spot.
 * The user's clipboard is restored afterwards.
 */
export async function injectClipboardImagesAndPrompt({
  pty,
  runtimeId,
  imagePaths,
  prompt,
}: {
  pty: Pty;
  runtimeId: RuntimeId;
  imagePaths: string[];
  prompt?: string;
}): Promise<void> {
  const segments = splitPromptByImageMarkers((prompt ?? '').trim(), imagePaths);
  if (segments.length === 0) return;
  await waitForTuiReady(pty);
  log.info('injectClipboardImagesAndPrompt: injecting', {
    runtimeId,
    segments: segments.length,
    images: segments.filter((segment) => segment.type === 'image').length,
  });

  const saved = captureClipboard();
  try {
    for (const segment of segments) {
      if (segment.type === 'text') {
        if (segment.text.length === 0) continue;
        // Wrap every chunk in bracketed-paste markers (not just multiline
        // ones): raw `@`/`/` chars typed outside a paste would trigger the
        // TUI's own autocomplete popups mid-injection.
        pty.write(`\x1b[200~${segment.text}\x1b[201~`);
        await sleep(TEXT_SEGMENT_DELAY_MS);
        continue;
      }
      const image = nativeImage.createFromPath(segment.path);
      if (image.isEmpty()) {
        log.warn('injectClipboardImagesAndPrompt: image could not be decoded, falling back', {
          imagePath: segment.path,
        });
        pty.write(`\x1b[200~@${segment.path}\x1b[201~`);
        await sleep(TEXT_SEGMENT_DELAY_MS);
        continue;
      }
      clipboard.writeImage(image);
      pty.write(CTRL_V);
      await sleep(IMAGE_PASTE_DELAY_MS);
    }

    await sleep(Math.max(getAgentCommandSubmitDelayMs(runtimeId), PROMPT_SUBMIT_DELAY_MS));
    pty.write(getAgentCommandSubmitInput(runtimeId));
    // Restore only after the TUI has had a chance to read the last image.
    await sleep(CLIPBOARD_RESTORE_DELAY_MS);
  } finally {
    restoreClipboard(saved);
  }
}

/** Resolves once PTY output has been quiet for TUI_READY_QUIET_MS (or on timeout). */
function waitForTuiReady(pty: Pty): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(timeout);
      resolve();
    };
    // Pty.onData has no unsubscribe; the handler turns into a no-op once done.
    pty.onData(() => {
      if (done) return;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, TUI_READY_QUIET_MS);
      quietTimer.unref?.();
    });
    const timeout = setTimeout(finish, TUI_READY_TIMEOUT_MS);
    timeout.unref?.();
  });
}

type SavedClipboard = { image: NativeImage; text: string };

function captureClipboard(): SavedClipboard {
  return { image: clipboard.readImage(), text: clipboard.readText() };
}

function restoreClipboard(saved: SavedClipboard): void {
  try {
    if (!saved.image.isEmpty()) clipboard.writeImage(saved.image);
    else if (saved.text) clipboard.writeText(saved.text);
    else clipboard.clear();
  } catch (error) {
    log.warn('injectClipboardImagesAndPrompt: failed to restore clipboard', {
      error: String(error),
    });
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
