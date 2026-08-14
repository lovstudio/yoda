import { readFile, stat } from 'node:fs/promises';
import type { BackgroundJob, BackgroundJobStatus } from '@shared/agent-background-jobs';
import { readFileTail } from '@main/utils/file-lines';
import { resolveTask } from '../projects/utils';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { parseClaudeBackgroundJobs } from './claude-background-jobs';
import { resolveTranscriptPath } from './transcript-feed';

/**
 * Read side of the background-job feature: what the panel asks for when it
 * mounts, and the output tail it shows for a selected job.
 *
 * The live counter that drives status indicators does not come through here —
 * it rides the run-state tailer and reaches the renderer on
 * `agentSessionStatusChangedChannel`. This module is the on-demand detail view.
 */

/** A single job's output can be long-running and chatty; only the tail is useful. */
const OUTPUT_TAIL_BYTES = 64 * 1024;

export interface BackgroundJobOutputTail {
  path: string;
  text: string;
  /** The file was longer than the tail window. */
  truncated: boolean;
  totalSize: number;
}

export async function getConversationBackgroundJobs(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<BackgroundJob[]> {
  const jobs = await readBackgroundJobs(projectId, taskId, conversationId);
  return await Promise.all(jobs.map(withLastOutputAt));
}

export async function getConversationBackgroundJobOutputTail(
  projectId: string,
  taskId: string,
  conversationId: string,
  jobTaskId: string
): Promise<BackgroundJobOutputTail | null> {
  // The path comes from our own parse, never from the caller: these files live
  // in the CLI's private temp tree, outside every filesystem allowlist, so a
  // renderer-supplied path would be an arbitrary-read hole.
  const jobs = await readBackgroundJobs(projectId, taskId, conversationId);
  const outputPath = jobs.find((job) => job.taskId === jobTaskId)?.outputPath;
  if (!outputPath) return null;
  try {
    const tail = await readFileTail(outputPath, OUTPUT_TAIL_BYTES);
    return { path: outputPath, ...tail };
  } catch {
    return null;
  }
}

/**
 * In-memory first: the run-state tailer keeps a full parse of the live session,
 * so a mounted conversation needs no disk read. Everything else re-parses the
 * transcript, because a job may have been launched thousands of lines ago —
 * further back than any tail-window reader looks.
 */
async function readBackgroundJobs(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<BackgroundJob[]> {
  const session = { projectId, taskId, conversationId };
  const remembered = agentSessionRuntimeStore.getBackgroundJobs(session);
  if (remembered.length > 0) return remembered;

  const filePath = await resolveTranscriptPath(projectId, taskId, conversationId).catch(() => null);
  if (!filePath) return [];
  const raw = await readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) return [];

  const jobs = parseClaudeBackgroundJobs(raw);
  return hasLiveSession(projectId, taskId, conversationId) ? jobs : retireRunningJobs(jobs);
}

function hasLiveSession(projectId: string, taskId: string, conversationId: string): boolean {
  return (
    resolveTask(projectId, taskId)
      ?.conversations.getActiveSessions()
      .some((session) => session.conversationId === conversationId) ?? false
  );
}

/**
 * Without a live CLI process there is nothing left to own a background job —
 * they are its children. An unterminated launch row then means the completion
 * notification was never written, not that the job survived.
 */
function retireRunningJobs(jobs: readonly BackgroundJob[]): BackgroundJob[] {
  return jobs.map((job) =>
    job.status === 'running' ? { ...job, status: 'stopped' as BackgroundJobStatus } : job
  );
}

/** Mtime of the output file is the only "still producing something" signal we get. */
async function withLastOutputAt(job: BackgroundJob): Promise<BackgroundJob> {
  if (!job.outputPath) return job;
  const stats = await stat(job.outputPath).catch(() => null);
  if (!stats) return job;
  return { ...job, lastOutputAt: stats.mtimeMs };
}
