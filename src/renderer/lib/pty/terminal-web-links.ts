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
  /(?:https?|HTTPS?|ftp|FTP):\/\/[^\s"'<>`、，。；：！？（）「」『』【】〈〉《》“”‘’]+/g;
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
const TABLE_SEPARATOR_RUN_RE = /[─━—-]{3,}/gu;
const TABLE_CONTEXT_MAX_DISTANCE = 24;

// Markdown inline links `[label](url)` — the agent's ink renderer often prints
// these literally, where only the bare URL inside the parens was clickable.
// Match the whole span so the label is clickable too; the captured group is the
// URL to open. Titles (`[label](url "title")`) fall back to the bare-URL match.
const MARKDOWN_LINK_REGEX = /(!?)\[[^\]\n]*\]\(((?:https?|ftp):\/\/[^\s)]+)\)/gi;

interface TerminalWebLinkCandidate {
  url: string;
  /** Index of the clickable span's first character within the scan line. */
  index: number;
  /** Length of the clickable span (the full `[label](url)` for markdown links). */
  length: number;
}

interface TableColumnRange {
  start: number;
  end: number;
}

interface TableCellChunk {
  lineIndex: number;
  startCellOffset: number;
  text: string;
  charOffset: number;
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
  const tableWrappedMatches = getTableWrappedWebLinkMatches(terminal, bufferLineNumber);

  // Shares the file-link scan window: soft-wrapped rows joined, plus
  // conservative hard-wrap continuation joining (Claude Code's ink renderer
  // breaks long URLs with real newlines).
  const chunks = buildScanChunks(bufferLineNumber - 1, terminal);
  if (chunks.length === 0) return tableWrappedMatches;
  const line = chunks.map((chunk) => chunk.text).join('');

  const matches: TerminalWebLinkMatch[] = [...tableWrappedMatches];
  for (const candidate of extractTerminalWebLinkCandidates(line)) {
    const range = mapScanRangeToBufferRange(terminal, chunks, candidate.index, candidate.length);
    if (!range) continue;
    if (tableWrappedMatches.some((match) => terminalLinkRangesOverlap(match.range, range)))
      continue;

    matches.push({ range, url: candidate.url });
  }

  return matches;
}

function getTableWrappedWebLinkMatches(
  terminal: Terminal,
  bufferLineNumber: number
): TerminalWebLinkMatch[] {
  const lineIndex = bufferLineNumber - 1;
  const context = findTableContext(terminal, lineIndex);
  if (!context) return [];

  const matches: TerminalWebLinkMatch[] = [];
  for (const column of context.columns) {
    const chunks = buildTableCellChunks(
      terminal,
      context.startLineIndex,
      context.endLineIndex,
      column
    );
    if (chunks.length < 2) continue;
    const cellText = chunks.map((chunk) => chunk.text).join('');

    for (const candidate of extractTerminalWebLinkCandidates(cellText)) {
      if (!hasMatchingCellWrapper(cellText, candidate)) continue;
      const candidateEnd = candidate.index + candidate.length;
      const fragments = chunks.flatMap((chunk) => {
        const chunkEnd = chunk.charOffset + chunk.text.length;
        const start = Math.max(candidate.index, chunk.charOffset);
        const end = Math.min(candidateEnd, chunkEnd);
        if (start >= end) return [];
        return [
          {
            chunk,
            index: start - chunk.charOffset,
            length: end - start,
          },
        ];
      });
      if (fragments.length < 2) continue;

      for (const fragment of fragments) {
        if (fragment.chunk.lineIndex !== lineIndex) continue;
        const range = mapPhysicalLineRange(
          terminal,
          fragment.chunk,
          fragment.index,
          fragment.length
        );
        if (!range) continue;
        matches.push({ range, url: candidate.url });
      }
    }
  }

  return matches;
}

function findTableContext(
  terminal: Terminal,
  lineIndex: number
): {
  startLineIndex: number;
  endLineIndex: number;
  columns: TableColumnRange[];
} | null {
  const upper = findTableSeparator(terminal, lineIndex, -1);
  const lower = findTableSeparator(terminal, lineIndex, 1);
  if (!upper || !lower || !tableColumnsAlign(upper.columns, lower.columns)) return null;

  return {
    startLineIndex: upper.lineIndex + 1,
    endLineIndex: lower.lineIndex - 1,
    columns: upper.columns,
  };
}

function findTableSeparator(
  terminal: Terminal,
  fromLineIndex: number,
  direction: -1 | 1
): { lineIndex: number; columns: TableColumnRange[] } | null {
  for (let distance = 1; distance <= TABLE_CONTEXT_MAX_DISTANCE; distance += 1) {
    const lineIndex = fromLineIndex + distance * direction;
    if (lineIndex < 0) break;
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line) break;
    const columns = getTableSeparatorColumns(line.translateToString(true));
    if (columns) return { lineIndex, columns };
  }
  return null;
}

function getTableSeparatorColumns(line: string): TableColumnRange[] | null {
  TABLE_SEPARATOR_RUN_RE.lastIndex = 0;
  const columns = [...line.matchAll(TABLE_SEPARATOR_RUN_RE)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  return columns.length >= 2 ? columns : null;
}

function tableColumnsAlign(left: TableColumnRange[], right: TableColumnRange[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (column, index) =>
        Math.abs(column.start - right[index].start) <= 1 &&
        Math.abs(column.end - right[index].end) <= 1
    )
  );
}

function buildTableCellChunks(
  terminal: Terminal,
  startLineIndex: number,
  endLineIndex: number,
  column: TableColumnRange
): TableCellChunk[] {
  const chunks: TableCellChunk[] = [];
  let charOffset = 0;

  for (let lineIndex = startLineIndex; lineIndex <= endLineIndex; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line || line.isWrapped) continue;
    const rawText = line.translateToString(true, column.start, column.end);
    const leadingSpaces = /^ */.exec(rawText)?.[0].length ?? 0;
    const text = rawText.slice(leadingSpaces).trimEnd();
    if (!text) continue;

    chunks.push({
      lineIndex,
      startCellOffset: column.start + leadingSpaces,
      text,
      charOffset,
    });
    charOffset += text.length;
  }

  return chunks;
}

function hasMatchingCellWrapper(cellText: string, candidate: TerminalWebLinkCandidate): boolean {
  if (candidate.length !== candidate.url.length) return false;
  const closer = cellText[candidate.index + candidate.length];
  const opener = closer ? CELL_WRAPPER_OPENERS[closer] : undefined;
  if (!closer || !opener) return false;

  const prefix = cellText.slice(0, candidate.index);
  return prefix.lastIndexOf(opener) > prefix.lastIndexOf(closer);
}

function mapPhysicalLineRange(
  terminal: Terminal,
  chunk: TableCellChunk,
  index: number,
  length: number
): ILink['range'] | null {
  return mapScanRangeToBufferRange(
    terminal,
    [
      {
        startLineIndex: chunk.lineIndex,
        startCellOffset: chunk.startCellOffset,
        rowCount: 1,
        text: chunk.text,
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
