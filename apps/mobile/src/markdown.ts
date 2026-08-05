export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'code'; language?: string; text: string };

export type InlineMarkdownToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

function splitTableRow(value: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inCode = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    const next = value[index + 1];

    if (character === '\\' && next === '|') {
      cell += '|';
      index += 1;
      continue;
    }
    if (character === '`') inCode = !inCode;
    if (character === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());

  if (cells[0] === '') cells.shift();
  if (cells.at(-1) === '') cells.pop();
  return cells;
}

function isTableDivider(value: string): boolean {
  const cells = splitTableRow(value);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  if (cells.length > columnCount) {
    return [...cells.slice(0, columnCount - 1), cells.slice(columnCount - 1).join(' | ')];
  }
  return [...cells, ...Array.from({ length: columnCount - cells.length }, () => '')];
}

export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r/g, '').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language: fence[1], text: codeLines.join('\n').trimEnd() });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? '').trim())) {
        quoteLines.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quoteLines.join('\n').trim() });
      continue;
    }

    const nextLine = (lines[index + 1] ?? '').trim();
    if (trimmed.includes('|') && isTableDivider(nextLine)) {
      const headers = splitTableRow(trimmed);
      const divider = splitTableRow(nextLine);
      if (headers.length > 0 && headers.length === divider.length) {
        flushParagraph();
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length) {
          const row = (lines[index] ?? '').trim();
          if (!row || !row.includes('|')) break;
          rows.push(normalizeTableRow(splitTableRow(row), headers.length));
          index += 1;
        }
        blocks.push({ kind: 'table', headers, rows });
        continue;
      }
    }

    const listMatch = trimmed.match(/^((?:[-*+])|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const ordered = /\d+[.)]/.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const item = current.match(/^((?:[-*+])|\d+[.)])\s+(.+)$/);
        if (!item || /\d+[.)]/.test(item[1]) !== ordered) break;
        items.push(item[2].trim());
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}

export function tokenizeInlineMarkdown(value: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: 'text', text: value.slice(cursor, match.index) });
    }

    const raw = match[0];
    if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ kind: 'bold', text: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      tokens.push({ kind: 'code', text: raw.slice(1, -1) });
    } else {
      const link = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      tokens.push(
        link ? { kind: 'link', text: link[1], url: link[2] } : { kind: 'text', text: raw }
      );
    }

    cursor = match.index + raw.length;
  }

  if (cursor < value.length) {
    tokens.push({ kind: 'text', text: value.slice(cursor) });
  }

  return tokens.length > 0 ? tokens : [{ kind: 'text', text: value }];
}
