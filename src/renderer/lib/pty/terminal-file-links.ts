import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

const MAX_WRAPPED_LINE_LENGTH = 2048;
const FILE_PATH_CANDIDATE_REGEX =
  /(^|[\s"'([{<:：])(@?(?:(?:~|\.{1,2})\/|\/)?(?:[^\s"'`$<>|\\:：]+\/)+[^\s"'`$<>|\\/:：]*\.[^\s"'`$<>|\\/:：]{1,32}(?::\d+(?::\d+)?)?)(?=$|[\s"')\]}>,，。；;!?！？(])/gu;

export interface TerminalFileLinkTarget {
  originalText: string;
  filePath: string;
  line?: number;
  column?: number;
}

export interface TerminalFileLinkOptions {
  workspaceRoot?: string;
  onOpen: (target: TerminalFileLinkTarget) => void;
}

interface TerminalFileLinkCandidate {
  text: string;
  index: number;
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

export function resolveTerminalFileLinkTarget(
  text: string,
  workspaceRoot?: string
): TerminalFileLinkTarget | null {
  const parsed = parsePathLocation(text);
  if (!parsed) return null;

  let filePath = parsed.path.replace(/\\/g, '/');
  if (filePath.startsWith('@')) filePath = filePath.slice(1);
  const normalizedRoot = workspaceRoot?.replace(/\\/g, '/').replace(/\/+$/g, '');

  if (filePath.startsWith('~/')) return null;

  if (filePath.startsWith('/')) {
    if (!normalizedRoot || !filePath.startsWith(`${normalizedRoot}/`)) return null;
    filePath = filePath.slice(normalizedRoot.length + 1);
  }

  const normalizedPath = normalizeWorkspaceRelativePath(filePath);
  if (!normalizedPath) return null;

  return {
    originalText: text,
    filePath: normalizedPath,
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

    const [lines, startLineIndex] = getWindowedLineStrings(bufferLineNumber - 1, this.terminal);
    const line = lines.join('');
    if (!line) {
      callback(undefined);
      return;
    }

    const links: ILink[] = [];
    for (const candidate of extractTerminalFileLinkCandidates(line)) {
      const target = resolveTerminalFileLinkTarget(candidate.text, options.workspaceRoot);
      if (!target) continue;

      const range = mapStringRangeToViewportRange(
        this.terminal,
        startLineIndex,
        candidate.index,
        candidate.text.length
      );
      if (!range) continue;

      links.push({
        range,
        text: candidate.text,
        decorations: {
          pointerCursor: true,
          underline: true,
        },
        activate: (event) => {
          if (!isTerminalFileLinkActivation(event)) return;
          event.preventDefault();
          event.stopPropagation();
          this.getOptions()?.onOpen(target);
        },
      });
    }

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

function mapStringRangeToViewportRange(
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

function isTerminalFileLinkActivation(event: MouseEvent): boolean {
  return event.button === 0;
}
