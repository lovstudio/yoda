import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { buildScanChunks, mapScanRangeToBufferRange } from './terminal-file-links';
import {
  createTerminalLinkHoverHandlers,
  isTerminalLinkActivation,
} from './terminal-link-activation';
import { isTerminalLinkCellInRange, type TerminalLinkCellPosition } from './terminal-link-target';

// Mirrors @xterm/addon-web-links' URL regex (RFC-style), with CJK punctuation
// treated as hard delimiters because Chinese/Japanese prose often has no
// whitespace after punctuation.
const URL_REGEX =
  /(?:https?|HTTPS?|ftp|FTP|file|FILE):\/\/[^\s"'<>`、，。；：！？（）「」『』【】〈〉《》“”‘’]+[^\s"'<>`、，。；：！？（）「」『』【】〈〉《》“”‘’.,;:!?)\]}]/g;

// Markdown inline links `[label](url)` — the agent's ink renderer often prints
// these literally, where only the bare URL inside the parens was clickable.
// Match the whole span so the label is clickable too; the captured group is the
// URL to open. Titles (`[label](url "title")`) fall back to the bare-URL match.
const MARKDOWN_LINK_REGEX = /(!?)\[[^\]\n]*\]\(((?:https?|ftp|file):\/\/[^\s)]+)\)/gi;

interface TerminalWebLinkCandidate {
  url: string;
  /** Index of the clickable span's first character within the scan line. */
  index: number;
  /** Length of the clickable span (the full `[label](url)` for markdown links). */
  length: number;
}

export interface TerminalWebLinkOptions {
  onOpen: (url: string) => void;
}

export interface TerminalWebLinkMatch {
  range: ILink['range'];
  url: string;
}

export function extractTerminalWebLinkCandidates(line: string): TerminalWebLinkCandidate[] {
  const candidates: TerminalWebLinkCandidate[] = [];
  // Spans already claimed by a markdown link, so the bare-URL pass below skips
  // the URL nested inside it (no overlapping links for the same cells).
  const consumed: Array<[number, number]> = [];

  MARKDOWN_LINK_REGEX.lastIndex = 0;
  for (const match of line.matchAll(MARKDOWN_LINK_REGEX)) {
    const url = match[2];
    if (!url) continue;
    // The clickable span starts at the `[` (skipping a leading `!` for images).
    const index = (match.index ?? 0) + (match[1]?.length ?? 0);
    const length = match[0].length - (match[1]?.length ?? 0);
    candidates.push({ url, index, length });
    consumed.push([index, index + length]);
  }

  URL_REGEX.lastIndex = 0;
  for (const match of line.matchAll(URL_REGEX)) {
    const url = match[0];
    if (!url) continue;
    const index = match.index ?? 0;
    if (consumed.some(([start, end]) => index >= start && index < end)) continue;
    candidates.push({ url, index, length: url.length });
  }

  return candidates;
}

export function getTerminalWebLinkMatches(
  terminal: Terminal,
  bufferLineNumber: number
): TerminalWebLinkMatch[] {
  // Shares the file-link scan window: soft-wrapped rows joined, plus
  // conservative hard-wrap continuation joining (Claude Code's ink renderer
  // breaks long URLs with real newlines).
  const chunks = buildScanChunks(bufferLineNumber - 1, terminal);
  if (chunks.length === 0) return [];
  const line = chunks.map((chunk) => chunk.text).join('');

  const matches: TerminalWebLinkMatch[] = [];
  for (const candidate of extractTerminalWebLinkCandidates(line)) {
    const range = mapScanRangeToBufferRange(terminal, chunks, candidate.index, candidate.length);
    if (!range) continue;

    matches.push({ range, url: candidate.url });
  }

  return matches;
}

export function getTerminalWebLinkAtCell(
  terminal: Terminal,
  bufferLineNumber: number,
  position: TerminalLinkCellPosition
): TerminalWebLinkMatch | null {
  return (
    getTerminalWebLinkMatches(terminal, bufferLineNumber).find((match) =>
      isTerminalLinkCellInRange(match.range, position)
    ) ?? null
  );
}

export function registerTerminalWebLinkProvider(
  terminal: Terminal,
  getOptions: () => TerminalWebLinkOptions | null
): { dispose: () => void } {
  return terminal.registerLinkProvider(new TerminalWebLinkProvider(terminal, getOptions));
}

class TerminalWebLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly getOptions: () => TerminalWebLinkOptions | null
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const options = this.getOptions();
    if (!options) {
      callback(undefined);
      return;
    }

    const links = getTerminalWebLinkMatches(this.terminal, bufferLineNumber).map((match): ILink => {
      const hoverHandlers = createTerminalLinkHoverHandlers(this.terminal);

      return {
        range: match.range,
        text: match.url,
        decorations: {
          pointerCursor: true,
          underline: true,
        },
        activate: (event) => {
          if (!isTerminalLinkActivation(event)) return;
          event.preventDefault();
          event.stopPropagation();
          this.getOptions()?.onOpen(match.url);
        },
        hover: hoverHandlers.hover,
        leave: hoverHandlers.leave,
        dispose: hoverHandlers.dispose,
      };
    });

    callback(links.length > 0 ? links : undefined);
  }
}
