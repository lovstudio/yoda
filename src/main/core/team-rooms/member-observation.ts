import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseGitHubRepository } from '@shared/github-repository';
import type { TeamMemberObservation } from '@shared/team-communication';
import { getConversationSessionInfo } from '@main/core/conversations/getConversationSessionInfo';
import { resolveTask } from '@main/core/projects/utils';
import { githubRoomMonitor } from './github-room-monitor';
import { getRoom } from './store';

export async function getTeamMemberObservation(
  roomId: string,
  memberId: string
): Promise<TeamMemberObservation | null> {
  const snapshot = await getRoom(roomId);
  const member = snapshot?.members.find((candidate) => candidate.id === memberId);
  if (!snapshot || !member) return null;

  const taskPath = resolveTask(snapshot.room.projectId, snapshot.room.taskId)?.conversations
    .taskPath;
  const sessionInfo =
    member.conversationId && taskPath
      ? await getConversationSessionInfo(
          snapshot.room.projectId,
          snapshot.room.taskId,
          member.conversationId,
          taskPath
        ).catch(() => null)
      : null;
  const sharedFilePath =
    snapshot.room.communication.mode === 'shared-file' && taskPath
      ? resolveInsideTask(taskPath, snapshot.room.communication.sharedFilePath)
      : null;
  const sharedFile = sharedFilePath
    ? await stat(sharedFilePath)
        .then((metadata) => ({
          exists: metadata.isFile(),
          updatedAt: metadata.mtime.toISOString(),
        }))
        .catch(() => ({ exists: false, updatedAt: null }))
    : { exists: false, updatedAt: null };
  const github =
    snapshot.room.communication.mode === 'github'
      ? await githubRoomMonitor.getState(roomId).catch(() => null)
      : null;
  const repository = parseGitHubRepository(
    github?.repository ?? snapshot.room.communication.githubRepository
  );

  return {
    memberId,
    mode: snapshot.room.communication.mode,
    runtimeStatus: member.status,
    processId: sessionInfo?.process?.pid ?? null,
    processStatus: sessionInfo?.process?.status ?? null,
    transcriptPath: sessionInfo?.transcriptPath ?? null,
    sharedFilePath,
    sharedFileExists: sharedFile.exists,
    sharedFileUpdatedAt: sharedFile.updatedAt,
    githubIssueUrl:
      repository && snapshot.room.communication.githubIssueNumber
        ? `${repository.repositoryUrl}/issues/${snapshot.room.communication.githubIssueNumber}`
        : null,
    githubPullRequestUrl:
      repository && snapshot.room.communication.githubPullRequestNumber
        ? `${repository.repositoryUrl}/pull/${snapshot.room.communication.githubPullRequestNumber}`
        : null,
    githubMonitorState: github?.state ?? null,
    githubLastCheckedAt: github?.lastCheckedAt ?? null,
    githubMonitorError: github?.lastError ?? null,
    updatedAt:
      sessionInfo?.process?.updatedAt ??
      sharedFile.updatedAt ??
      github?.lastCheckedAt ??
      new Date().toISOString(),
  };
}

function resolveInsideTask(taskPath: string, configuredPath: string): string | null {
  const resolved = resolve(taskPath, configuredPath);
  const fromTask = relative(taskPath, resolved);
  if (
    isAbsolute(fromTask) ||
    fromTask === '..' ||
    fromTask.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    return null;
  }
  return resolved;
}
