import type { ConversationExecutionMode } from '@shared/conversations';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import type { PromptInjectionTarget } from '@shared/prompt-library';
import { withExecutionModeInstructions } from '../execution-mode';
import { getEnabledPromptPrinciplesText } from './prompt-principles';

/**
 * Assembles everything appended after the runtime's own system prompt at spawn,
 * in one place so the local and SSH conversation impls stay in step.
 *
 * Order is deliberate: the facet block goes first because it establishes *where*
 * the agent is working, which the prompt principles then constrain *how*.
 *
 * Resolvers are injected by the caller (the workspace factory) so this module —
 * and the conversation unit tests through it — stay free of the project/db
 * import chain.
 */
export async function buildAppendSystemPrompt(params: {
  resolveFacetInstructions?: () => Promise<string | undefined>;
  resolveProjectPromptPrinciples?: () => Promise<ProjectPromptPrinciples | undefined>;
  target: PromptInjectionTarget;
  executionMode: ConversationExecutionMode | undefined;
}): Promise<string | undefined> {
  const facetInstructions = await params.resolveFacetInstructions?.();
  const principlesText = await getEnabledPromptPrinciplesText(
    await params.resolveProjectPromptPrinciples?.(),
    params.target
  );

  const base = [facetInstructions?.trim(), principlesText?.trim()].filter(Boolean).join('\n\n');
  return withExecutionModeInstructions(base.length > 0 ? base : undefined, params.executionMode);
}
