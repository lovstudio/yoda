import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import {
  createTerminalLinkHoverHandlers,
  isTerminalLinkActivation,
} from './terminal-link-activation';
import { isTerminalLinkCellInRange, type TerminalLinkCellPosition } from './terminal-link-target';

const MAX_WRAPPED_LINE_LENGTH = 2048;
// Characters that may not appear inside a file path segment (the negated set
// below). Includes ASCII whitespace/quotes/shell metas plus CJK punctuation and
// brackets so paths like `bar.txt。` or `foo.md（…）` terminate cleanly.
const PATH_SEG_EXCLUDED = `\\s"'\`$<>|\\\\:：（）「」『』【】〈〉《》，。；！？`;
const PATH_LEADING = `\\s"'([{<:：（「『【〈《`;
const PATH_TRAILING = `\\s"')\\]}>,，。；;!?！？.(（）「」『』【】〈〉《》`;
// File extension: 1–32 path chars after a dot, but the final char may not be a
// dot so a trailing sentence period (`foo.md.`) is left out of the link.
const PATH_EXT = `[^${PATH_SEG_EXCLUDED}\\/]{0,31}[^${PATH_SEG_EXCLUDED}\\/.]`;
const FILE_PATH_CANDIDATE_REGEX = new RegExp(
  `(^|[${PATH_LEADING}])(@?(?:(?:~|\\.{1,2})\\/|\\/)?(?:[^${PATH_SEG_EXCLUDED}]+\\/)+[^${PATH_SEG_EXCLUDED}\\/]*\\.${PATH_EXT}(?::\\d+(?::\\d+)?)?)(?=$|[${PATH_TRAILING}])`,
  'gu'
);

export interface TerminalFileLinkTarget {
  originalText: string;
  /**
   * Workspace-relative path. Set only when the link resolves inside the
   * current workspace; absent for `~/...` paths or absolute paths that fall
   * outside `workspaceRoot`.
   */
  filePath?: string;
  /**
   * Absolute filesystem path. Always set for local sessions when the home dir
   * is known (so `~/...` can be expanded); may be derived by joining
   * `workspaceRoot` + `filePath` for workspace-internal paths.
   */
  absolutePath?: string;
  line?: number;
  column?: number;
}

export interface TerminalFileLinkOptions {
  workspaceRoot?: string;
  /** Home directory used to expand `~/...` paths. */
  homeDir?: string;
  /** Disable menu items that require local filesystem access. */
  isRemote?: boolean;
  onOpen: (target: TerminalFileLinkTarget) => void;
}

interface TerminalFileLinkCandidate {
  text: string;
  index: number;
}

export interface TerminalFileLinkMatch {
  range: ILink['range'];
  text: string;
  target: TerminalFileLinkTarget;
}

export function extractTerminalFileLinkCandidates(line: string): TerminalFileLinkCandidate[] {
  const candidates: TerminalFileLinkCandidate[] = [];

  for (const match of line.matchAll(FILE_PATH_CANDIDATE_REGEX)) {
    const text = match[2];
    if (!text) continue;
    if (text.includes('://') || text.startsWith('//')) continue;

    const leading = match[1] ?? '';
    candidates.push({
      text,
      index: match.index + leading.length,
    });
  }

  return candidates;
}

export function getTerminalFileLinkMatches(
  terminal: Terminal,
  bufferLineNumber: number,
  options: TerminalFileLinkOptions
): TerminalFileLinkMatch[] {
  const [lines, startLineIndex] = getWindowedLineStrings(bufferLineNumber - 1, terminal);
  const line = lines.join('');
  if (!line) return [];

  const matches: TerminalFileLinkMatch[] = [];
  for (const candidate of extractTerminalFileLinkCandidates(line)) {
    const target = resolveTerminalFileLinkTarget(
      candidate.text,
      options.workspaceRoot,
      options.homeDir
    );
    if (!target) continue;

    const range = mapStringRangeToViewportRange(
      terminal,
      startLineIndex,
      candidate.index,
      candidate.text.length
    );
    if (!range) continue;

    matches.push({ range, text: candidate.text, target });
  }

  return matches;
}

export function getTerminalFileLinkAtCell(
  terminal: Terminal,
  bufferLineNumber: number,
  position: TerminalLinkCellPosition,
  options: TerminalFileLinkOptions
): TerminalFileLinkMatch | null {
  return (
    getTerminalFileLinkMatches(terminal, bufferLineNumber, options).find((match) =>
      isTerminalLinkCellInRange(match.range, position)
    ) ?? null
  );
}

export function resolveTerminalFileLinkTarget(
  text: string,
  workspaceRoot?: string,
  homeDir?: string
): TerminalFileLinkTarget | null {
  const parsed = parsePathLocation(text);
  if (!parsed) return null;

  let rawPath = parsed.path.replace(/\\/g, '/');
  if (rawPath.startsWith('@')) rawPath = rawPath.slice(1);
  const normalizedRoot = workspaceRoot?.replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedHome = homeDir?.replace(/\\/g, '/').replace(/\/+$/g, '');

  // Expand `~/...` against the home dir when provided.
  if (rawPath.startsWith('~/')) {
    if (!normalizedHome) return null;
    rawPath = `${normalizedHome}/${rawPath.slice(2)}`;
  }

  // Absolute path: try to slot into the workspace; otherwise keep as absolute.
  if (rawPath.startsWith('/')) {
    const inWorkspace =
      normalizedRoot && (rawPath === normalizedRoot || rawPath.startsWith(`${normalizedRoot}/`));
    if (inWorkspace) {
      const relative = rawPath === normalizedRoot ? '' : rawPath.slice(normalizedRoot.length + 1);
      const normalizedRelative = normalizeWorkspaceRelativePath(relative);
      if (!normalizedRelative) return null;
      return {
        originalText: text,
        filePath: normalizedRelative,
        absolutePath: `${normalizedRoot}/${normalizedRelative}`,
        line: parsed.line,
        column: parsed.column,
      };
    }
    return {
      originalText: text,
      absolutePath: rawPath,
      line: parsed.line,
      column: parsed.column,
    };
  }

  // Workspace-relative path.
  const normalizedRelative = normalizeWorkspaceRelativePath(rawPath);
  if (!normalizedRelative) return null;

  return {
    originalText: text,
    filePath: normalizedRelative,
    absolutePath: normalizedRoot ? `${normalizedRoot}/${normalizedRelative}` : undefined,
    line: parsed.line,
    column: parsed.column,
  };
}

export function registerTerminalFileLinkProvider(
  terminal: Terminal,
  getOptions: () => TerminalFileLinkOptions | null
): { dispose: () => void } {
  return terminal.registerLinkProvider(new TerminalFileLinkProvider(terminal, getOptions));
}

class TerminalFileLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly getOptions: () => TerminalFileLinkOptions | null
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const options = this.getOptions();
    if (!options) {
      callback(undefined);
      return;
    }

    const links = getTerminalFileLinkMatches(this.terminal, bufferLineNumber, options).map(
      (match): ILink => {
        const hoverHandlers = createTerminalLinkHoverHandlers(this.terminal);

        return {
          range: match.range,
          text: match.text,
          decorations: {
            pointerCursor: true,
            underline: true,
          },
          activate: (event) => {
            if (!isTerminalLinkActivation(event)) return;
            event.preventDefault();
            event.stopPropagation();
            this.getOptions()?.onOpen(match.target);
          },
          hover: hoverHandlers.hover,
          leave: hoverHandlers.leave,
          dispose: hoverHandlers.dispose,
        };
      }
    );

    callback(links.length > 0 ? links : undefined);
  }
}

function parsePathLocation(text: string): { path: string; line?: number; column?: number } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const match = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(trimmed);
  if (!match?.[1]) return null;

  const line = match[2] ? Number(match[2]) : undefined;
  const column = match[3] ? Number(match[3]) : undefined;

  return {
    path: match[1],
    line: line && Number.isFinite(line) ? line : undefined,
    column: column && Number.isFinite(column) ? column : undefined,
  };
}

function normalizeWorkspaceRelativePath(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join('/') : null;
}

export function getWindowedLineStrings(lineIndex: number, terminal: Terminal): [string[], number] {
  let line: IBufferLine | undefined;
  let topIndex = lineIndex;
  let bottomIndex = lineIndex;
  let length = 0;
  let content = '';
  const lines: string[] = [];

  line = terminal.buffer.active.getLine(lineIndex);
  if (!line) return [lines, topIndex];

  const currentContent = line.translateToString(true);
  if (line.isWrapped && currentContent[0] !== ' ') {
    length = 0;
    while (
      (line = terminal.buffer.active.getLine(--topIndex)) &&
      length < MAX_WRAPPED_LINE_LENGTH
    ) {
      content = line.translateToString(true);
      length += content.length;
      lines.push(content);
      if (!line.isWrapped || content.includes(' ')) break;
    }
    lines.reverse();
  }

  lines.push(currentContent);

  length = 0;
  while (
    (line = terminal.buffer.active.getLine(++bottomIndex)) &&
    line.isWrapped &&
    length < MAX_WRAPPED_LINE_LENGTH
  ) {
    content = line.translateToString(true);
    length += content.length;
    lines.push(content);
    if (content.includes(' ')) break;
  }

  return [lines, topIndex];
}

export function mapStringRangeToViewportRange(
  terminal: Terminal,
  lineIndex: number,
  stringIndex: number,
  stringLength: number
): ILink['range'] | null {
  const [startY, startX] = mapStringIndexToBufferCell(terminal, lineIndex, 0, stringIndex);
  const [endY, endX] = mapStringIndexToBufferCell(terminal, startY, startX, stringLength);

  if (startY === -1 || startX === -1 || endY === -1 || endX === -1) return null;

  return {
    start: { x: startX + 1, y: startY + 1 },
    end: { x: endX, y: endY + 1 },
  };
}

function mapStringIndexToBufferCell(
  terminal: Terminal,
  lineIndex: number,
  rowIndex: number,
  stringIndex: number
): [number, number] {
  const buffer = terminal.buffer.active;
  const cell = buffer.getNullCell();
  let start = rowIndex;

  while (stringIndex) {
    const line = buffer.getLine(lineIndex);
    if (!line) return [-1, -1];

    for (let i = start; i < line.length; i += 1) {
      line.getCell(i, cell);
      const chars = cell.getChars();
      if (cell.getWidth()) {
        stringIndex -= chars.length || 1;

        if (i === line.length - 1 && chars === '') {
          const nextLine = buffer.getLine(lineIndex + 1);
          if (nextLine?.isWrapped) {
            nextLine.getCell(0, cell);
            if (cell.getWidth() === 2) stringIndex += 1;
          }
        }
      }

      if (stringIndex < 0) return [lineIndex, i];
    }

    lineIndex += 1;
    start = 0;
  }

  return [lineIndex, start];
}
