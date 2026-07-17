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
const PATH_SEG_EXCLUDED = `\\s"'\`$<>|\\\\:：()（）「」『』【】〈〉《》，、。；！？`;
const PATH_LEADING = `\\s"'([{<:：（「『【〈《、`;
const PATH_TRAILING = `\\s"')\\]}>,，、。；;!?！？.(（）「」『』【】〈〉《》`;
// File extension: 1–32 path chars after a dot, but the final char may not be a
// dot so a trailing sentence period (`foo.md.`) is left out of the link.
const PATH_EXT = `[^${PATH_SEG_EXCLUDED}\\/]{0,31}[^${PATH_SEG_EXCLUDED}\\/.]`;
const PATH_SEG_TOKEN = `[^${PATH_SEG_EXCLUDED}\\/]+`;
// Unquoted absolute paths may contain one internal ASCII-space boundary per
// directory component (`Application Support/`). Keeping the allowance local
// prevents prose such as `/project and src/main.ts` from becoming one link.
const ABSOLUTE_PATH_SEGMENT = `${PATH_SEG_TOKEN}(?: +${PATH_SEG_TOKEN})?`;
// A filename may contain several words and punctuation that otherwise acts as
// a prose delimiter (`Agent 时代，我们需要怎样的 IDE.pdf`). Keep this broader
// allowance on the basename only, and require its final word to carry the file
// extension, so trailing prose is not absorbed into the link.
const SPACED_FILENAME_TOKEN = `[^\\s"'\`$<>|\\\\/:]+`;
const SPACED_ABSOLUTE_FILENAME = `${SPACED_FILENAME_TOKEN}(?: +${SPACED_FILENAME_TOKEN})* +[^\\s"'\`$<>|\\\\/:]*\\.${PATH_EXT}`;
// A path is either a file (one or more `dir/` segments + a `name.ext`, optional
// `:line:col`) OR a directory (one or more `dir/` segments ending in a slash,
// no filename). Making the filename tail optional lets a trailing-slash run
// like `output/slide-deck/moments-chronicle/` match as a folder; without a
// trailing slash a path still needs an extension to count (so `src/main` is
// not a link but `src/main/` and `src/main/index.ts` are).
const FILE_PATH_CANDIDATE_REGEX = new RegExp(
  `(^|[${PATH_LEADING}])(@?(?:(?:~|\\.{1,2})\\/|\\/)?(?:[^${PATH_SEG_EXCLUDED}]+\\/)+(?:[^${PATH_SEG_EXCLUDED}\\/]*\\.${PATH_EXT}(?::\\d+(?::\\d+)?)?)?)(?=$|[${PATH_TRAILING}])`,
  'gu'
);
const ROOTED_FILE_PATH_CANDIDATE_REGEX = new RegExp(
  `(^|[${PATH_LEADING}])(@?\\/(?:${ABSOLUTE_PATH_SEGMENT}\\/)+?[^${PATH_SEG_EXCLUDED}\\/]*\\.${PATH_EXT}(?::\\d+(?::\\d+)?)?)(?!(?:\\.| +)${PATH_SEG_TOKEN}\\/)(?=$|[${PATH_TRAILING}])`,
  'gu'
);
const ROOTED_SPACED_FILENAME_CANDIDATE_REGEX = new RegExp(
  `(^|[${PATH_LEADING}])(@?\\/(?:${ABSOLUTE_PATH_SEGMENT}\\/)+?${SPACED_ABSOLUTE_FILENAME}(?::\\d+(?::\\d+)?)?)(?=$|[${PATH_TRAILING}])`,
  'gu'
);
// Home-relative, extensionless multi-segment paths are commonly emitted for
// checkout/worktree directories without a trailing slash (`~/repo/.worktrees/id`).
// Keep this form home-rooted and space-free so ordinary relative prose remains
// outside the link.
const TILDE_DIRECTORY_CANDIDATE_REGEX = new RegExp(
  `(^|[${PATH_LEADING}])(@?~\\/(?:${PATH_SEG_TOKEN}\\/)+[^${PATH_SEG_EXCLUDED}\\/.]+)(?!\\.${PATH_SEG_TOKEN})(?=$|[${PATH_TRAILING}])`,
  'gu'
);
const FILE_PATH_CANDIDATE_REGEXES: readonly {
  regex: RegExp;
  requiresSpace: boolean;
  isDirectory?: true;
}[] = [
  { regex: ROOTED_SPACED_FILENAME_CANDIDATE_REGEX, requiresSpace: true },
  { regex: ROOTED_FILE_PATH_CANDIDATE_REGEX, requiresSpace: true },
  { regex: TILDE_DIRECTORY_CANDIDATE_REGEX, requiresSpace: false, isDirectory: true },
  { regex: FILE_PATH_CANDIDATE_REGEX, requiresSpace: false },
];

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
  /**
   * True when the link points at a directory (from a trailing `/` or a
   * directory-only candidate such as an extensionless `~/...` path).
   * Directory targets carry only `absolutePath` (no `filePath`/`line`/`column`)
   * so clicking opens the folder in the OS file manager instead of routing to
   * the in-app file editor, which can only show files.
   */
  isDirectory?: boolean;
}

export interface TerminalFileLinkOptions {
  workspaceRoot?: string;
  /**
   * Equivalent checkout roots whose absolute paths should resolve inside the
   * active workspace (for example, the main checkout while viewing a worktree).
   */
  workspaceRootAliases?: readonly string[];
  /** Home directory used to expand `~/...` paths. */
  homeDir?: string;
  /** SSH connection used by shared remote file actions. */
  sshConnectionId?: string;
  onOpen: (target: TerminalFileLinkTarget) => void;
}

interface TerminalFileLinkCandidate {
  text: string;
  index: number;
  isDirectory?: true;
}

export interface TerminalFileLinkMatch {
  range: ILink['range'];
  text: string;
  target: TerminalFileLinkTarget;
}

export function extractTerminalFileLinkCandidates(line: string): TerminalFileLinkCandidate[] {
  const candidates: TerminalFileLinkCandidate[] = [];

  for (const { regex, requiresSpace, isDirectory } of FILE_PATH_CANDIDATE_REGEXES) {
    for (const match of line.matchAll(regex)) {
      const text = match[2];
      if (!text) continue;
      if (requiresSpace && !text.includes(' ')) continue;
      if (text.includes('://') || text.startsWith('//')) continue;

      const leading = match[1] ?? '';
      const index = match.index + leading.length;
      const end = index + text.length;
      const overlapsExisting = candidates.some(
        (candidate) => index < candidate.index + candidate.text.length && candidate.index < end
      );
      if (overlapsExisting) continue;

      candidates.push({ text, index, ...(isDirectory ? { isDirectory: true as const } : {}) });
    }
  }

  return candidates.sort((left, right) => left.index - right.index);
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
      options.homeDir,
      options.workspaceRootAliases,
      candidate.isDirectory
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
const URL_CONTINUATION_START_RE = /[A-Za-z0-9._~:/?#@!$&'*+,;=%-]/;
const URL_CONTINUATION_HINT_RE = /[/:?#&=%]/;
const HARD_WRAP_LOCATION_RE = new RegExp(`^:\\d+(?::\\d+)?(?=$|[${PATH_TRAILING}])`, 'u');

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
    const continuationIndent = first.text.length - stripped.length;
    if (!canHardJoin(terminal, upperBottom, upperText, stripped, continuationIndent)) break;
    first.startCellOffset += continuationIndent;
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
    const continuationIndent = nextText.length - stripped.length;
    if (!canHardJoin(terminal, lastBottom, last.text, stripped, continuationIndent)) break;
    chunks.push({
      startLineIndex: nextStart,
      startCellOffset: continuationIndent,
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
  lowerStripped: string,
  continuationIndent: number
): boolean {
  if (hasIndentedPathContinuation(upperText, lowerStripped, continuationIndent)) return true;
  if (!isRowFull(terminal, upperBottomRowIndex)) return false;
  if (hasHardWrappedLocationCandidate(upperText, lowerStripped)) return true;
  const tail = TRAILING_PATH_RUN_RE.exec(upperText)?.[0];
  if (!tail || !tail.includes('/')) return false;
  if (!lowerStripped || PATH_SEG_EXCLUDED_RE.test(lowerStripped[0])) return false;
  if (URL_IN_PROGRESS_RE.test(upperText) && !canHardJoinUrl(upperText, lowerStripped)) return false;
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

/**
 * Ink-style renderers may insert a real newline and indentation while wrapping
 * a path before the terminal's last column. Keep this exception narrower than
 * the general hard-wrap rule: the upper fragment must end at a visible path
 * break (`/` between segments or `-` inside a filename), the lower row must be
 * indented, and joining them must produce a complete file candidate that
 * crosses the row boundary.
 */
function hasIndentedPathContinuation(
  upperText: string,
  lowerStripped: string,
  continuationIndent: number
): boolean {
  if (continuationIndent < 2 || !lowerStripped || URL_IN_PROGRESS_RE.test(upperText)) return false;

  const tail = TRAILING_PATH_RUN_RE.exec(upperText)?.[0];
  if (!tail || tail === '/' || !tail.includes('/')) return false;

  const joinedCandidate = extractTerminalFileLinkCandidates(`${tail}${lowerStripped}`).find(
    (candidate) => candidate.index === 0 && candidate.text.length > tail.length
  );
  if (!joinedCandidate || joinedCandidate.text.endsWith('/')) return false;
  if (tail.endsWith('/')) return true;

  // A trailing hyphen is a word-wrap opportunity used by Ink renderers inside
  // long basenames (`terminal-file-` + `links.ts`). Keep this filename case
  // distinct from directory continuation: the next row may only contribute
  // the rest of that basename, never another path with its own `/`.
  if (!tail.endsWith('-')) return false;
  const continuation = joinedCandidate.text.slice(tail.length);
  if (!/^[\p{L}\p{N}]/u.test(continuation) || continuation.includes('/')) return false;

  return !extractTerminalFileLinkCandidates(lowerStripped).some(
    (candidate) => candidate.index === 0
  );
}

/**
 * A `file:line:column` target may be hard-wrapped anywhere in its location
 * suffix, including immediately before the first colon. Validate the joined
 * candidate as a complete path with a line number before overriding the
 * conservative path-continuation rules.
 */
function hasHardWrappedLocationCandidate(upperText: string, lowerStripped: string): boolean {
  if (!lowerStripped || URL_IN_PROGRESS_RE.test(upperText)) return false;
  const partialLocation = /:(?:\d*)(?::\d*)?$/.exec(upperText)?.[0] ?? '';
  const pathText = upperText.slice(0, upperText.length - partialLocation.length);
  const pathEndsAtBoundary = extractTerminalFileLinkCandidates(pathText).some(
    (candidate) =>
      !candidate.text.endsWith('/') && candidate.index + candidate.text.length === pathText.length
  );
  if (!pathEndsAtBoundary) return false;

  const locationContinuation = `${partialLocation}${lowerStripped}`;
  return HARD_WRAP_LOCATION_RE.test(locationContinuation);
}

function canHardJoinUrl(upperText: string, lowerStripped: string): boolean {
  const first = lowerStripped[0];
  if (!first || !URL_CONTINUATION_START_RE.test(first)) return false;
  if (/^[._~:/?#@!$&'*+,;=%-]$/.test(first)) return true;
  if (/[?&=#%]$/.test(upperText)) return true;

  const leadingToken = /^[^\s"'<>`、，。；：！？（）「」『』【】〈〉《》“”‘’.,;:!?)\]}]+/u.exec(
    lowerStripped
  )?.[0];
  return Boolean(leadingToken && URL_CONTINUATION_HINT_RE.test(leadingToken));
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
    scanIndex - chunk.charOffset,
    isEnd
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
  homeDir?: string,
  workspaceRootAliases?: readonly string[],
  directoryHint = false
): TerminalFileLinkTarget | null {
  const parsed = parsePathLocation(text);
  if (!parsed) return null;

  let rawPath = parsed.path.replace(/\\/g, '/');
  if (rawPath.startsWith('@')) rawPath = rawPath.slice(1);
  const isDirectory = directoryHint || rawPath.endsWith('/');
  const normalizedRoot = workspaceRoot?.replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedRootAliases = workspaceRootAliases
    ?.map((root) => root.replace(/\\/g, '/').replace(/\/+$/g, ''))
    .filter((root) => root && root !== normalizedRoot);
  const normalizedHome = homeDir?.replace(/\\/g, '/').replace(/\/+$/g, '');

  // Expand `~/...` against the home dir when provided.
  if (rawPath.startsWith('~/')) {
    const homeRelativePath = rawPath.slice(2).replace(/\/+$/g, '');
    if (normalizedHome) {
      rawPath = `${normalizedHome}/${homeRelativePath}`;
    } else if (isDirectory && normalizedRoot && normalizedRoot.endsWith(`/${homeRelativePath}`)) {
      // The current workspace itself is often printed as a compact `~/...`
      // directory before the async home-directory query has completed.
      rawPath = normalizedRoot;
    } else {
      return null;
    }
  }

  // A directory equal to the workspace root has no workspace-relative tail;
  // keep the absolute root instead of rejecting the empty relative path.
  if (isDirectory && normalizedRoot && rawPath.replace(/\/+$/g, '') === normalizedRoot) {
    return { originalText: text, isDirectory: true, absolutePath: normalizedRoot };
  }

  const base = resolveFileTarget(text, rawPath, parsed, normalizedRoot, normalizedRootAliases);
  if (!base) return null;
  if (!isDirectory) return base;

  // Directories have no in-app editor view: collapse to the absolute folder
  // path (slashes stripped) so the click/menu opens it in the OS file manager.
  return {
    originalText: text,
    isDirectory: true,
    absolutePath: base.absolutePath?.replace(/\/+$/g, ''),
  };
}

function resolveFileTarget(
  text: string,
  rawPath: string,
  parsed: { line?: number; column?: number },
  normalizedRoot?: string,
  normalizedRootAliases?: readonly string[]
): TerminalFileLinkTarget | null {
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
    if (normalizedRoot) {
      for (const alias of normalizedRootAliases ?? []) {
        const inAlias = rawPath === alias || rawPath.startsWith(`${alias}/`);
        if (!inAlias) continue;
        const relative = rawPath === alias ? '' : rawPath.slice(alias.length + 1);
        const normalizedRelative = normalizeWorkspaceRelativePath(relative);
        if (!normalizedRelative) return null;
        if (isCheckoutMetadataPath(normalizedRelative, alias, normalizedRoot)) continue;
        return {
          originalText: text,
          filePath: normalizedRelative,
          absolutePath: `${normalizedRoot}/${normalizedRelative}`,
          line: parsed.line,
          column: parsed.column,
        };
      }
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

function isCheckoutMetadataPath(
  relativePath: string,
  aliasRoot: string,
  workspaceRoot: string
): boolean {
  const firstSegment = relativePath.split('/', 1)[0];
  if (firstSegment === '.git' || firstSegment === '.worktrees') return true;

  if (!workspaceRoot.startsWith(`${aliasRoot}/`)) return false;
  const workspaceRelative = workspaceRoot.slice(aliasRoot.length + 1);
  const lastSeparator = workspaceRelative.lastIndexOf('/');
  if (lastSeparator <= 0) return false;
  const poolRelative = workspaceRelative.slice(0, lastSeparator);
  return relativePath === poolRelative || relativePath.startsWith(`${poolRelative}/`);
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
  if (line.isWrapped) {
    length = 0;
    while (
      (line = terminal.buffer.active.getLine(--topIndex)) &&
      length < MAX_WRAPPED_LINE_LENGTH
    ) {
      content = line.translateToString(true);
      length += content.length;
      lines.push(content);
      if (!line.isWrapped) break;
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
  }

  return [lines, topIndex];
}

function mapStringIndexToBufferCell(
  terminal: Terminal,
  lineIndex: number,
  rowIndex: number,
  stringIndex: number,
  isEnd: boolean
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

    // The requested index may be exactly one cell past a full row. Keep that
    // endpoint on the current row (`x = cols`) instead of leaking to `x = 0`
    // on the next row, which is not a valid xterm link coordinate.
    if (isEnd && stringIndex === 0) return [lineIndex, line.length];

    lineIndex += 1;
    start = 0;
  }

  return [lineIndex, start];
}
