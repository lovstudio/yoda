import type { MobileSessionTranscriptBlock } from '@lovstudio/yoda-protocol/mobile-api';

/**
 * Returns the latest Agent reply as one renderable block. A completed final
 * answer wins over commentary from the same turn; while a turn is still in
 * progress, its commentary remains capturable.
 */
export function getLatestAssistantReply(
  blocks: readonly MobileSessionTranscriptBlock[]
): MobileSessionTranscriptBlock | null {
  let lastUserIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.role !== 'user') continue;
    lastUserIndex = index;
    break;
  }
  const assistantBlocks = blocks
    .slice(lastUserIndex + 1)
    .filter((block) => block.role === 'assistant' && block.content.trim().length > 0);
  if (assistantBlocks.length === 0) return null;

  const finalBlocks = assistantBlocks.filter((block) => block.agentPhase === 'final');
  const selected = finalBlocks.length > 0 ? finalBlocks : assistantBlocks;
  const latest = selected.at(-1)!;

  return {
    ...latest,
    id: selected.map((block) => block.id).join(':'),
    agentPhase: finalBlocks.length > 0 ? 'final' : latest.agentPhase,
    format: selected.some((block) => block.format === 'markdown') ? 'markdown' : latest.format,
    content: selected.map((block) => block.content.trim()).join('\n\n'),
  };
}
