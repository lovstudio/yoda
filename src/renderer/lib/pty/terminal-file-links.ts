import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import {
  createTerminalLinkHoverHandlers,
  isTerminalLinkActivation,
} from './terminal-link-activation';
import { isTerminalLinkCellInRange, type TerminalLinkCellPosition } from './terminal-link-target';

const MAX_WRAPPED_LINE_LENGTH = 2048;
// Characters that may not appear inside a file path segment (the negated set
// below). Includes ASCII whitespace/quotes/shell metas/parens plus CJK
// punctuation and brackets so paths like `bar.txt。` or `foo.md(…)` /
// `foo.md（…）` terminate cleanly instead of swallowing trailing prose.
const PATH_SEG_EXCLUDED = `\\s"'\`$<>|\\\\:：()（）「」『』【】〈〉《》，。；！？`;
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
  const chunks = buildScanChunks(bufferLineNumber - 1, terminal);
  if (chunks.length === 0) return [];
  const line = chunks.map((chunk) => chunk.text).join('');

  const matches: TerminalFileLinkMatch[] = [];
  for (const candidate of extractTerminalFileLinkCandidates(line)) {
    const target = resolveTerminalFileLinkTarget(
      candidate.text,
      options.workspaceRoot,
      options.homeDir
    );
    if (!target) continue;

    const range = mapScanRangeToBufferRange(
      terminal,
      chunks,
      candidate.index,
      candidate.text.length
    );
    if (!range) continue;

    matches.push({ range, text: candidate.text, target });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Hard-wrap joining
//
// TUI programs (Claude Code's ink renderer in particular) wrap long lines by
// writing real newlines, so a path split across rows has `isWrapped === false`
// on the continuation row and is invisible to the soft-wrap window above. We
// conservatively join such rows into one scan string: the upper row must be
// physically full to the last column and end mid-path (a trailing path run
// containing `/`), and the lower row must continue with path characters after
// its indent. Each chunk remembers where its text starts in the buffer so
// match positions map back to cells across the join.
// ---------------------------------------------------------------------------

const HARD_WRAP_JOIN_MAX = 4;
const PATH_SEG_EXCLUDED_RE = new RegExp(`[${PATH_SEG_EXCLUDED}]`, 'u');
const TRAILING_PATH_RUN_RE = new RegExp(`[^${PATH_SEG_EXCLUDED}]+$`, 'u');
const COMPLETE_EXT_RE = /\.[A-Za-z0-9]{1,8}$/;
const URL_IN_PROGRESS_RE = /(?:https?|ftp|file):\/\/\S+$/i;

export interface ScanChunk {
  /** Buffer row index of the chunk's first row. */
  startLineIndex: number;
  /** Cell offset of the chunk's first character (stripped continuation indent). */
  startCellOffset: number;
  /** Number of buffer rows covered by this chunk. */
  rowCount: number;
  /** Chunk text (soft-wrapped rows joined; leading indent stripped on continuations). */
  text: string;
  /** Offset of `text` within the joined scan string. */
  charOffset: number;
}

export function buildScanChunks(lineIndex: number, terminal: Terminal): ScanChunk[] {
  const [lines, startLineIndex] = getWindowedLineStrings(lineIndex, terminal);
  const text = lines.join('');
  if (!text) return [];

  const chunks: ScanChunk[] = [
    { startLineIndex, startCellOffset: 0, rowCount: lines.length, text, charOffset: 0 },
  ];
  const buffer = terminal.buffer.active;

  // Extend upward: the hovered row may be the continuation of a path that
  // starts on the previous (hard-wrapped) logical line.
  for (let i = 0; i < HARD_WRAP_JOIN_MAX; i++) {
    const first = chunks[0];
    if (first.startLineIndex === 0) break;
    // Only a chunk anchored at a hard line start can have been hard-wrapped onto.
    if (buffer.getLine(first.startLineIndex)?.isWrapped !== false) break;
    const upperBottom = first.startLineIndex - 1;
    const [upperLines, upperStart] = getWindowedLineStrings(upperBottom, terminal);
    const upperText = upperLines.join('');
    const stripped = first.text.replace(/^ +/, '');
    if (!canHardJoin(terminal, upperBottom, upperText, stripped)) break;
    first.startCellOffset += first.text.length - stripped.length;
    first.text = stripped;
    chunks.unshift({
      startLineIndex: upperStart,
      startCellOffset: 0,
      rowCount: upperLines.length,
      text: upperText,
      charOffset: 0,
    });
  }

  // Extend downward: a path starting in the hovered line may continue onto the
  // next (hard-wrapped) logical line.
  for (let i = 0; i < HARD_WRAP_JOIN_MAX; i++) {
    const last = chunks[chunks.length - 1];
    const lastBottom = last.startLineIndex + last.rowCount - 1;
    const nextLine = buffer.getLine(lastBottom + 1);
    if (!nextLine || nextLine.isWrapped) break;
    const [nextLines, nextStart] = getWindowedLineStrings(lastBottom + 1, terminal);
    const nextText = nextLines.join('');
    const stripped = nextText.replace(/^ +/, '');
    if (!canHardJoin(terminal, lastBottom, last.text, stripped)) break;
    chunks.push({
      startLineIndex: nextStart,
      startCellOffset: nextText.length - stripped.length,
      rowCount: nextLines.length,
      text: stripped,
      charOffset: 0,
    });
  }

  let offset = 0;
  for (const chunk of chunks) {
    chunk.charOffset = offset;
    offset += chunk.text.length;
  }
  return chunks;
}

function canHardJoin(
  terminal: Terminal,
  upperBottomRowIndex: number,
  upperText: string,
  lowerStripped: string
): boolean {
  if (!isRowFull(terminal, upperBottomRowIndex)) return false;
  const tail = TRAILING_PATH_RUN_RE.exec(upperText)?.[0];
  if (!tail || !tail.includes('/')) return false;
  if (!lowerStripped || PATH_SEG_EXCLUDED_RE.test(lowerStripped[0])) return false;
  // A complete-looking extension at the break usually IS the path end (the row
  // just happens to be full) — only join when the continuation clearly extends
  // it (`.gz` of a wrapped `archive.tar.gz`, or another path segment). A row
  // ending mid-URL is exempt: `https://github.c` + `om/...` must still join.
  if (
    COMPLETE_EXT_RE.test(tail) &&
    !URL_IN_PROGRESS_RE.test(upperText) &&
    lowerStripped[0] !== '.' &&
    lowerStripped[0] !== '/'
  ) {
    return false;
  }
  return true;
}

/** True when the row's last column holds a character (hard-wrap break point). */
function isRowFull(terminal: Terminal, rowIndex: number): boolean {
  const line = terminal.buffer.active.getLine(rowIndex);
  if (!line || line.length === 0) return false;
  const cell = terminal.buffer.active.getNullCell();
  line.getCell(line.length - 1, cell);
  const chars = cell.getChars();
  if (chars !== '' && chars !== ' ') return true;
  // The last cell may be the empty spacer half of a width-2 (CJK) character.
  if (chars === '' && line.length >= 2) {
    line.getCell(line.length - 2, cell);
    if (cell.getWidth() === 2) return true;
  }
  return false;
}

export function mapScanRangeToBufferRange(
  terminal: Terminal,
  chunks: ScanChunk[],
  scanIndex: number,
  length: number
): ILink['range'] | null {
  const start = mapScanIndexToCell(terminal, chunks, scanIndex, false);
  const end = mapScanIndexToCell(terminal, chunks, scanIndex + length, true);
  if (!start || !end) return null;
  if (start[0] === -1 || start[1] === -1 || end[0] === -1 || end[1] === -1) return null;

  return {
    start: { x: start[1] + 1, y: start[0] + 1 },
    end: { x: end[1], y: end[0] + 1 },
  };
}

function mapScanIndexToCell(
  terminal: Terminal,
  chunks: ScanChunk[],
  scanIndex: number,
  isEnd: boolean
): [number, number] | null {
  let chunk: ScanChunk | null = null;
  for (const candidate of chunks) {
    // An end index sitting exactly on a chunk boundary belongs to the previous
    // chunk (one-past-last-char), a start index to the next chunk.
    if (isEnd ? candidate.charOffset < scanIndex : candidate.charOffset <= scanIndex) {
      chunk = candidate;
    } else {
      break;
    }
  }
  if (!chunk) return null;
  return mapStringIndexToBufferCell(
    terminal,
    chunk.startLineIndex,
    chunk.startCellOffset,
    scanIndex - chunk.charOffset
  );
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

function getWindowedLineStrings(lineIndex: number, terminal: Terminal): [string[], number] {
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
