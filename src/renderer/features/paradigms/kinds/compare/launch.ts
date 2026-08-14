import { compareParadigmKind, paradigmSlot } from '@shared/paradigms/kinds';
import { defaultParadigmStamp } from '@shared/paradigms/stamp';
import { rpc } from '@renderer/lib/ipc';
import { requirementPromptBuilder } from '../../agent-launch-settings';
import {
  launchableSlot,
  type LaunchedParadigmAgent,
  type ParadigmLauncher,
} from '../../launch-context';

// Comparison wraps another paradigm rather than reimplementing one. Today the
// wrapped kind is always `single`; `params.inner` makes it selectable.
const INNER_KIND = 'single';
const INNER_SLOT = paradigmSlot(INNER_KIND, 'agent');

/**
 * Multi-config comparison: every variant spawns its own independent task
 * (possibly in a different project), then a detached window tiles them side by
 * side. Each task also lands in its project's sidebar, so closing the window
 * keeps the work.
 */
export const compareLauncher: ParadigmLauncher = {
  descriptor: compareParadigmKind,
  async launch(ctx, params) {
    const base = ctx.resolveSlot(INNER_SLOT.storageKey);
    const buildPrompt = requirementPromptBuilder(base.systemPrompt);
    const launched = await Promise.all(
      params.variants.map(async (variant, index): Promise<LaunchedParadigmAgent | null> => {
        if (!variant.projectId) return null;
        // Comparison is an explicit experiment surface: it runs a copy of the
        // base Agent on the runtime selected for this variant.
        const slot = launchableSlot(
          base.agent && variant.runtimeId ? { ...base, provider: variant.runtimeId } : base
        );
        if (!slot) return null;
        return ctx.launchVariant({
          projectId: variant.projectId,
          slot,
          buildPrompt,
          strategyKind: variant.strategyKind,
          baseBranch: variant.baseBranch,
          nameSeed: `${ctx.baseName}-${index + 1}`,
          // Each variant task *is* a run of the wrapped paradigm; the comparison
          // is the window that tiles them, not something a task can be in.
          paradigm: defaultParadigmStamp(INNER_KIND),
        });
      })
    );
    const launches = launched.filter((launch): launch is LaunchedParadigmAgent => launch !== null);
    if (launches.length === 0) return;

    ctx.finish();
    const first = launches[0];
    if (first) ctx.focusTask(first.projectId, first.taskId);
    for (const launch of launches) ctx.scheduleDeferredPrompt(launch, buildPrompt);
    void rpc.app.openComparisonWindow({
      panes: launches.map((launch) => ({ projectId: launch.projectId, taskId: launch.taskId })),
      layout: { kind: 'columns', count: launches.length },
    });
    void Promise.allSettled(launches.map((launch) => launch.promise)).then(ctx.reportFailures);
  },
};
