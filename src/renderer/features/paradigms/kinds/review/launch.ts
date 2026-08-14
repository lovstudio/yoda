import { paradigmSlot, reviewParadigmKind } from '@shared/paradigms/kinds';
import { defaultParadigmStamp } from '@shared/paradigms/stamp';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { agentSkillSelection, buildRequirementPrompt } from '../../agent-launch-settings';
import { launchableSlot, type ParadigmLauncher } from '../../launch-context';

const IMPLEMENTER_SLOT = paradigmSlot('review', 'implementer');
const REVIEWER_SLOT = paradigmSlot('review', 'reviewer');

/**
 * Implementer + reviewer loop. Only the implementer gets a seat here; the
 * reviewer is spawned by the main-process orchestration, which owns the round
 * limit and the accept/reject verdicts.
 */
export const reviewLauncher: ParadigmLauncher = {
  descriptor: reviewParadigmKind,
  stamp: (params) => {
    const base = defaultParadigmStamp('review');
    return {
      ...base,
      paradigmParams: {
        ...(base.paradigmParams as object),
        reviewerRuntime: params.reviewerRuntime,
      },
    };
  },
  async launch(ctx, params) {
    const implementer = launchableSlot(ctx.resolveSlot(IMPLEMENTER_SLOT.storageKey));
    const reviewer = launchableSlot(
      ctx.resolveSlot(REVIEWER_SLOT.storageKey, params.reviewerRuntime)
    );
    if (!implementer || !reviewer) return;
    const buildPrompt = (requirement: string) =>
      buildRequirementPrompt({ requirement, systemPrompt: implementer.systemPrompt });
    const launch = ctx.launchAgent({
      slot: implementer,
      buildPrompt,
      nameSeed: `${ctx.baseName}-implement`,
    });
    ctx.focusTask(launch.projectId, launch.taskId);
    ctx.finish();
    // The orchestration needs the final requirement text, so it starts only once
    // a deferred rewrite has landed in the implementer's session.
    const orchestration = ctx
      .requirementForOrchestration(launch, buildPrompt)
      .then((requirement) => {
        if (requirement === null) return undefined;
        return rpc.reviewOrchestration.start({
          projectId: launch.projectId,
          taskId: launch.taskId,
          implementerConversationId: launch.conversationId,
          requirement,
          reviewerRuntime: reviewer.provider,
          reviewerSystemPrompt: reviewer.systemPrompt,
          reviewerSkillSelection: agentSkillSelection(reviewer.agent),
          reviewerAutoApprove: ctx.isAutoApproving(reviewer.provider),
        });
      });
    void orchestration.catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Review mode orchestration failed.');
    });
  },
};
