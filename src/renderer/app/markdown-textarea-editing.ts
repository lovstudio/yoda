export interface TextSelection {
  start: number;
  end: number;
}

export interface MarkdownTextareaEdit {
  value: string;
  selection: TextSelection;
}

const MARKDOWN_INDENT = '  ';
const LIST_ITEM_PATTERN = /^(\s*)(?:(-|\*|\+)|(\d+)([.)]))(\s+)(?:(\[[ xX]\])\s+)?/;

function clampSelection(value: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  return { start, end };
}

function lineStartAt(value: string, index: number): number {
  if (index <= 0) return 0;
  return value.lastIndexOf('\n', index - 1) + 1;
}

function selectedLineStarts(value: string, selection: TextSelection): number[] {
  const start = lineStartAt(value, selection.start);
  const selectedEnd = selection.end > selection.start ? selection.end - 1 : selection.end;
  const last = lineStartAt(value, selectedEnd);
  const starts = [start];
  let index = start;

  while (index < last) {
    const nextLine = value.indexOf('\n', index);
    if (nextLine === -1) break;
    index = nextLine + 1;
    starts.push(index);
  }

  return starts;
}

function outdentSize(value: string, lineStart: number): number {
  if (value[lineStart] === '\t') return 1;

  let size = 0;
  while (size < MARKDOWN_INDENT.length && value[lineStart + size] === ' ') {
    size += 1;
  }
  return size;
}

function applyRemovalToPosition(position: number, start: number, size: number): number {
  if (position <= start) return position;
  if (position <= start + size) return start;
  return position - size;
}

function lineEndAt(value: string, index: number): number {
  const nextLine = value.indexOf('\n', index);
  return nextLine === -1 ? value.length : nextLine;
}

function isListLine(value: string, lineStart: number): boolean {
  return LIST_ITEM_PATTERN.test(value.slice(lineStart, lineEndAt(value, lineStart)));
}

export function applyMarkdownTabEdit(
  value: string,
  rawSelection: TextSelection,
  direction: 'indent' | 'outdent'
): MarkdownTextareaEdit {
  const selection = clampSelection(value, rawSelection);

  if (direction === 'indent' && selection.start === selection.end) {
    const lineStart = lineStartAt(value, selection.start);
    const insertAt = isListLine(value, lineStart) ? lineStart : selection.start;
    const nextValue = `${value.slice(0, insertAt)}${MARKDOWN_INDENT}${value.slice(insertAt)}`;
    const caret = selection.start + MARKDOWN_INDENT.length;
    return { value: nextValue, selection: { start: caret, end: caret } };
  }

  const starts = selectedLineStarts(value, selection);

  if (direction === 'indent') {
    let nextValue = value;
    let offset = 0;
    for (const start of starts) {
      const index = start + offset;
      nextValue = `${nextValue.slice(0, index)}${MARKDOWN_INDENT}${nextValue.slice(index)}`;
      offset += MARKDOWN_INDENT.length;
    }

    const firstStart = starts[0] ?? 0;
    const startShift = selection.start === firstStart ? 0 : MARKDOWN_INDENT.length;
    return {
      value: nextValue,
      selection: {
        start: selection.start + startShift,
        end: selection.end + starts.length * MARKDOWN_INDENT.length,
      },
    };
  }

  let nextValue = value;
  let nextStart = selection.start;
  let nextEnd = selection.end;
  let offset = 0;

  for (const start of starts) {
    const index = start - offset;
    const size = outdentSize(nextValue, index);
    if (size === 0) continue;

    nextValue = `${nextValue.slice(0, index)}${nextValue.slice(index + size)}`;
    nextStart = applyRemovalToPosition(nextStart, index, size);
    nextEnd = applyRemovalToPosition(nextEnd, index, size);
    offset += size;
  }

  return { value: nextValue, selection: { start: nextStart, end: nextEnd } };
}

export function applyMarkdownEnterEdit(
  value: string,
  rawSelection: TextSelection
): MarkdownTextareaEdit | null {
  const selection = clampSelection(value, rawSelection);
  if (selection.start !== selection.end) return null;

  const lineStart = lineStartAt(value, selection.start);
  const lineEnd = lineEndAt(value, selection.start);
  const beforeCaret = value.slice(lineStart, selection.start);
  const match = LIST_ITEM_PATTERN.exec(beforeCaret);
  if (!match) return null;

  const indent = match[1] ?? '';
  const bullet = match[2] ?? null;
  const orderedNumber = match[3] ?? null;
  const orderedDelimiter = match[4] ?? '.';
  const markerSpacing = match[5] ?? ' ';
  const checkbox = match[6] ?? null;
  const afterCaret = value.slice(selection.start, lineEnd);
  const content = `${beforeCaret.slice(match[0].length)}${afterCaret}`;

  if (content.trim().length === 0) {
    const nextValue = `${value.slice(0, lineStart)}${indent}${value.slice(lineEnd)}`;
    const caret = lineStart + indent.length;
    return { value: nextValue, selection: { start: caret, end: caret } };
  }

  const nextMarker = orderedNumber
    ? `${indent}${Number(orderedNumber) + 1}${orderedDelimiter}${markerSpacing}`
    : `${indent}${bullet}${markerSpacing}`;
  const insertion = checkbox ? `\n${nextMarker}[ ] ` : `\n${nextMarker}`;
  const caret = selection.start + insertion.length;

  return {
    value: `${value.slice(0, selection.start)}${insertion}${value.slice(selection.end)}`,
    selection: { start: caret, end: caret },
  };
}
