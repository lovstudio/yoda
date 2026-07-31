import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { buildScanChunks, mapScanRangeToBufferRange } from './terminal-file-links';
import {
  createTerminalLinkHoverHandlers,
  isTerminalLinkActivation,
} from './terminal-link-activation';
import { isTerminalLinkCellInRange, type TerminalLinkCellPosition } from './terminal-link-target';

// Starts from @xterm/addon-web-links' RFC-style URL matching, with CJK
// punctuation treated as hard delimiters because Chinese prose often has no
// whitespace after punctuation. ASCII closing delimiters stay in the raw
// candidate so balanced URL content can be distinguished from surrounding
// prose below.
const URL_REGEX =
  /(?:https?|HTTPS?|ftp|FTP|file|FILE):\/\/[^\s"'<>`、，。；：！？（）「」『』【】〈〉《》“”‘’]+/g;
const TRAILING_URL_PUNCTUATION_RE = /[.,;:!?]+$/u;
type AsciiOpeningDelimiter = '(' | '[' | '{';
const ASCII_CLOSING_DELIMITERS: Readonly<Record<string, AsciiOpeningDelimiter>> = {
  ')': '(',
  ']': '[',
  '}': '{',
};
const CELL_WRAPPER_OPENERS: Readonly<Record<string, string>> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '>': '<',
  '）': '（',
  '】': '【',
  '〉': '〈',
  '》': '《',
  '」': '「',
  '』': '『',
};
const CELL_URL_CONTINUATION_RE =
  /(^\s*|\s{2,})([A-Za-z0-9._~!$&'*+,;=:@%-]+)([)\]}>）】〉》」』])(?=\s{2,}\S|\s*$)/gu;
const CELL_GAP_RE = /\s{2,}/g;
const NEXT_CELL_AFTER_URL_RE = /^\s{2,}\S/u;

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

interface CellWrappedWebLinkCandidate {
  url: string;
  upper: { index: number; length: number };
  lower: { index: number; length: number };
}

export interface TerminalWebLinkOptions {
  onOpen: (url: string) => void;
}

export interface TerminalWebLinkMatch {
  range: ILink['range'];
  url: string;
}

function trimTerminalWebUrl(rawUrl: string): string {
  const delimiterDepth: Record<AsciiOpeningDelimiter, number> = {
    '(': 0,
    '[': 0,
    '{': 0,
  };

  for (let index = 0; index < rawUrl.length; index++) {
    const character = rawUrl[index];
    if (character === '(' || character === '[' || character === '{') {
      delimiterDepth[character]++;
      continue;
    }

    const openingDelimiter = character ? ASCII_CLOSING_DELIMITERS[character] : undefined;
    if (!openingDelimiter) continue;
    if (delimiterDepth[openingDelimiter] === 0) {
      return rawUrl.slice(0, index).replace(TRAILING_URL_PUNCTUATION_RE, '');
    }
    delimiterDepth[openingDelimiter]--;
  }

  return rawUrl.replace(TRAILING_URL_PUNCTUATION_RE, '');
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
    const url = match[0] ? trimTerminalWebUrl(match[0]) : '';
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
  const cellWrappedMatches = getCellWrappedWebLinkMatches(terminal, bufferLineNumber);

  // Shares the file-link scan window: soft-wrapped rows joined, plus
  // conservative hard-wrap continuation joining (Claude Code's ink renderer
  // breaks long URLs with real newlines).
  const chunks = buildScanChunks(bufferLineNumber - 1, terminal);
  if (chunks.length === 0) return cellWrappedMatches;
  const line = chunks.map((chunk) => chunk.text).join('');

  const matches: TerminalWebLinkMatch[] = [...cellWrappedMatches];
  for (const candidate of extractTerminalWebLinkCandidates(line)) {
    const range = mapScanRangeToBufferRange(terminal, chunks, candidate.index, candidate.length);
    if (!range) continue;
    if (cellWrappedMatches.some((match) => terminalLinkRangesOverlap(match.range, range))) continue;

    matches.push({ range, url: candidate.url });
  }

  return matches;
}

function getCellWrappedWebLinkMatches(
  terminal: Terminal,
  bufferLineNumber: number
): TerminalWebLinkMatch[] {
  const lineIndex = bufferLineNumber - 1;
  const pairs = [
    { upperLineIndex: lineIndex, lowerLineIndex: lineIndex + 1, fragment: 'upper' as const },
    { upperLineIndex: lineIndex - 1, lowerLineIndex: lineIndex, fragment: 'lower' as const },
  ];
  const matches: TerminalWebLinkMatch[] = [];

  for (const { upperLineIndex, lowerLineIndex, fragment } of pairs) {
    if (upperLineIndex < 0) continue;
    const upperLine = terminal.buffer.active.getLine(upperLineIndex);
    const lowerLine = terminal.buffer.active.getLine(lowerLineIndex);
    if (!upperLine || !lowerLine || upperLine.isWrapped || lowerLine.isWrapped) continue;

    const upperText = upperLine.translateToString(true);
    const lowerText = lowerLine.translateToString(true);
    for (const candidate of findCellWrappedWebLinkCandidates(
      terminal,
      upperLineIndex,
      upperText,
      lowerLineIndex,
      lowerText
    )) {
      const part = candidate[fragment];
      const partLineIndex = fragment === 'upper' ? upperLineIndex : lowerLineIndex;
      const partText = fragment === 'upper' ? upperText : lowerText;
      const range = mapPhysicalLineRange(
        terminal,
        partLineIndex,
        partText,
        part.index,
        part.length
      );
      if (!range) continue;
      matches.push({ range, url: candidate.url });
    }
  }

  return matches;
}

function findCellWrappedWebLinkCandidates(
  terminal: Terminal,
  upperLineIndex: number,
  upperText: string,
  lowerLineIndex: number,
  lowerText: string
): CellWrappedWebLinkCandidate[] {
  const lowerContinuations = [...lowerText.matchAll(CELL_URL_CONTINUATION_RE)].flatMap((match) => {
    const boundary = match[1] ?? '';
    const segment = match[2];
    const closer = match[3];
    if (!segment || !closer) return [];
    return [
      {
        segment,
        closer,
        index: (match.index ?? 0) + boundary.length,
      },
    ];
  });
  if (lowerContinuations.length === 0) return [];

  const matches: CellWrappedWebLinkCandidate[] = [];
  for (const upperCandidate of extractTerminalWebLinkCandidates(upperText)) {
    if (upperCandidate.length !== upperCandidate.url.length || !upperCandidate.url.endsWith('/')) {
      continue;
    }
    const upperEnd = upperCandidate.index + upperCandidate.length;
    if (!NEXT_CELL_AFTER_URL_RE.test(upperText.slice(upperEnd))) continue;

    const upperCellStart = findCellStartIndex(upperText, upperCandidate.index);
    const upperCellStartX = mapPhysicalLineRange(
      terminal,
      upperLineIndex,
      upperText,
      upperCellStart,
      1
    )?.start.x;
    if (upperCellStartX === undefined) continue;

    for (const lowerContinuation of lowerContinuations) {
      const opener = CELL_WRAPPER_OPENERS[lowerContinuation.closer];
      const cellPrefix = upperText.slice(upperCellStart, upperCandidate.index);
      if (
        !opener ||
        cellPrefix.lastIndexOf(opener) <= cellPrefix.lastIndexOf(lowerContinuation.closer)
      ) {
        continue;
      }

      const lowerStartX = mapPhysicalLineRange(
        terminal,
        lowerLineIndex,
        lowerText,
        lowerContinuation.index,
        1
      )?.start.x;
      if (lowerStartX !== upperCellStartX) continue;

      matches.push({
        url: `${upperCandidate.url}${lowerContinuation.segment}`,
        upper: { index: upperCandidate.index, length: upperCandidate.length },
        lower: { index: lowerContinuation.index, length: lowerContinuation.segment.length },
      });
    }
  }

  return matches;
}

function findCellStartIndex(line: string, beforeIndex: number): number {
  let cellStart = 0;
  CELL_GAP_RE.lastIndex = 0;
  for (const match of line.slice(0, beforeIndex).matchAll(CELL_GAP_RE)) {
    cellStart = (match.index ?? 0) + match[0].length;
  }
  return cellStart;
}

function mapPhysicalLineRange(
  terminal: Terminal,
  lineIndex: number,
  text: string,
  index: number,
  length: number
): ILink['range'] | null {
  return mapScanRangeToBufferRange(
    terminal,
    [
      {
        startLineIndex: lineIndex,
        startCellOffset: 0,
        rowCount: 1,
        text,
        charOffset: 0,
      },
    ],
    index,
    length
  );
}

function terminalLinkRangesOverlap(left: ILink['range'], right: ILink['range']): boolean {
  return (
    isTerminalLinkCellInRange(left, right.start) ||
    isTerminalLinkCellInRange(left, right.end) ||
    isTerminalLinkCellInRange(right, left.start) ||
    isTerminalLinkCellInRange(right, left.end)
  );
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
