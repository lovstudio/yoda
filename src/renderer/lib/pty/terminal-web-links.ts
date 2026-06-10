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

interface TerminalWebLinkCandidate {
  url: string;
  index: number;
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

  URL_REGEX.lastIndex = 0;
  for (const match of line.matchAll(URL_REGEX)) {
    const url = match[0];
    if (!url) continue;
    candidates.push({
      url,
      index: match.index ?? 0,
    });
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
    const range = mapScanRangeToBufferRange(
      terminal,
      chunks,
      candidate.index,
      candidate.url.length
    );
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
