import type { AgentReplyDisplayLevel } from './agent-reply-display';
import type { MobileSessionTranscriptBlock } from './mobile-api';

const INTERNAL_AGENT_REPLY_METADATA_PATTERN =
  /<oai-mem-citation\b[^>]*>[\s\S]*?<\/oai-mem-citation>/gi;

/** Remove runtime metadata that is useful for orchestration but not for a mobile reply. */
export function stripInternalAgentReplyMetadata(value: string): string {
  return value
    .replace(INTERNAL_AGENT_REPLY_METADATA_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Applies the same four reply-detail levels used by the desktop conversation surface
 * to the richer mobile transcript blocks.
 */
export function filterMobileSessionTranscript(
  transcript: readonly MobileSessionTranscriptBlock[],
  level: AgentReplyDisplayLevel
): MobileSessionTranscriptBlock[] {
  let visibleBlocks: MobileSessionTranscriptBlock[];
  switch (level) {
    case 'hidden':
      visibleBlocks = transcript.filter((block) => block.role === 'user');
      break;
    case 'concise':
      visibleBlocks = transcript.filter(
        (block) =>
          block.role === 'user' || (block.role === 'assistant' && block.agentPhase !== 'commentary')
      );
      break;
    case 'detailed':
      visibleBlocks = transcript.filter((block) => block.role !== 'tool');
      break;
    case 'verbose':
      visibleBlocks = [...transcript];
      break;
  }

  return visibleBlocks.flatMap((block) => {
    if (block.role !== 'assistant') return [block];
    const content = stripInternalAgentReplyMetadata(block.content);
    return content ? [{ ...block, content }] : [];
  });
}
