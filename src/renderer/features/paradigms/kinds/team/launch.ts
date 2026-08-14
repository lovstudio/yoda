import { teamParadigmKind } from '@shared/paradigms/kinds';
import { invalidateTeamRoomQueries } from '@renderer/features/agent-room/team-room-queries';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { ParadigmLauncher } from '../../launch-context';

/**
 * An Agent Team instantiated on one task. The task itself carries no session —
 * the room conductor drives @-routing between members, and each member surfaces
 * as one of the task's conversations.
 */
export const teamLauncher: ParadigmLauncher = {
  descriptor: teamParadigmKind,
  async launch(ctx, params) {
    const team = params.team;
    if (!team) return;
    const task = ctx.launchBareTask();
    ctx.focusTask(task.projectId, task.taskId);
    try {
      await task.promise;
      // The conductor writes into the task's worktree, so it must exist first.
      ctx.assertTaskReady(task);
      const requirement = await ctx.resolveRequirement();
      if (requirement === null) return;
      await rpc.teamRooms.createRoomFromTeam({
        projectId: task.projectId,
        taskId: task.taskId,
        teamId: team.id,
        requirement,
      });
      await invalidateTeamRoomQueries(ctx.queryClient, task.projectId, task.taskId);
      ctx.finish();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Agent team orchestration failed.');
    }
  },
};
