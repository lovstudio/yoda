import { paradigmSlot, specParadigmKind } from '@shared/paradigms/kinds';
import { withSystemPrompt } from '@shared/prompt-format';
import { launchableSlot, type ParadigmLauncher } from '../../launch-context';

const AGENT_SLOT = paradigmSlot('spec', 'agent');

/**
 * Spec work is a conversation, not an implementation: the Agent is told to
 * interrogate the requirement before it writes anything down.
 */
function buildSpecPrompt(args: { requirement: string; systemPrompt: string }): string {
  return withSystemPrompt(
    args.systemPrompt,
    [
      `Rough user requirement:`,
      args.requirement || '(No explicit requirement was provided.)',
      '',
      `Start the spec session now. Ask only material clarifying questions before drafting final artifacts unless the user explicitly asks you to draft from the current information.`,
    ].join('\n')
  );
}

export const specLauncher: ParadigmLauncher = {
  descriptor: specParadigmKind,
  async launch(ctx) {
    const slot = launchableSlot(ctx.resolveSlot(AGENT_SLOT.storageKey));
    if (!slot) return;
    const buildPrompt = (requirement: string) =>
      buildSpecPrompt({ requirement, systemPrompt: slot.systemPrompt });
    const launch = ctx.launchAgent({
      slot,
      buildPrompt,
      nameSeed: `${ctx.baseName}-spec`,
    });
    ctx.focusTask(launch.projectId, launch.taskId);
    ctx.scheduleDeferredPrompt(launch, buildPrompt);
    ctx.reportLaunchFailure(launch.promise);
    ctx.finish();
  },
};
