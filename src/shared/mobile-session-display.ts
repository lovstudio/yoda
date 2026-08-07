import type { AgentReplyDisplayLevel } from './agent-reply-display';
import type { MobileSessionTranscriptBlock } from './mobile-api';

/**
 * Applies the same four reply-detail levels used by the desktop conversation surface
 * to the richer mobile transcript blocks.
 */
export function filterMobileSessionTranscript(
  transcript: readonly MobileSessionTranscriptBlock[],
  level: AgentReplyDisplayLevel
): MobileSessionTranscriptBlock[] {
  switch (level) {
    case 'hidden':
      return transcript.filter((block) => block.role === 'user');
    case 'concise':
      return transcript.filter(
        (block) =>
          block.role === 'user' || (block.role === 'assistant' && block.agentPhase !== 'commentary')
      );
    case 'detailed':
      return transcript.filter((block) => block.role !== 'tool');
    case 'verbose':
      return [...transcript];
  }
}
