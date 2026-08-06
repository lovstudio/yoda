import type { MobileSessionTranscriptBlock } from './mobile-api';

const TOOL_PREVIEW_MAX_CHARS = 88;

export type MobileTranscriptRenderItem =
  | {
      kind: 'block';
      id: string;
      block: MobileSessionTranscriptBlock;
    }
  | {
      kind: 'tool-group';
      id: string;
      blocks: MobileSessionTranscriptBlock[];
    };

/**
 * Keep one stable render item for a contiguous run of tool calls. The first
 * tool id remains the group id while new calls arrive, so the count can grow
 * without remounting an expanded inspector.
 */
export function groupAdjacentMobileToolBlocks(
  blocks: MobileSessionTranscriptBlock[]
): MobileTranscriptRenderItem[] {
  const items: MobileTranscriptRenderItem[] = [];

  for (const block of blocks) {
    const previous = items.at(-1);
    if (block.role === 'tool') {
      if (previous?.kind === 'tool-group') {
        previous.blocks.push(block);
      } else {
        items.push({ kind: 'tool-group', id: block.id, blocks: [block] });
      }
      continue;
    }

    items.push({ kind: 'block', id: block.id, block });
  }

  return items;
}

export function mobileToolGroupTitle(blocks: MobileSessionTranscriptBlock[]): string {
  const titles = [...new Set(blocks.map((block) => block.title ?? 'Command'))];
  if (blocks.length === 1) return titles[0];
  return titles.length === 1 ? `${titles[0]}（${blocks.length}）` : `Tools（${blocks.length}）`;
}

/**
 * Tool inputs are frequently serialized inside JSON or JavaScript wrappers.
 * Restore layout-only escape sequences so the inspector reflects the command
 * or patch structure instead of showing one long line of literal `\\n`s.
 */
export function formatMobileToolTranscriptContent(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, '  ')
    .trimEnd();
}

export function summarizeMobileToolTranscriptContent(value: string): string {
  const firstLine = formatMobileToolTranscriptContent(value)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return 'No details';
  return firstLine.length > TOOL_PREVIEW_MAX_CHARS
    ? `${firstLine.slice(0, TOOL_PREVIEW_MAX_CHARS)}…`
    : firstLine;
}
