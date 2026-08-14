import type {
  BackgroundJob,
  BackgroundJobKind,
  BackgroundJobStatus,
} from '@shared/agent-background-jobs';
import { iterateLines } from '@main/utils/text-lines';

/**
 * Reads Claude Code's background jobs straight out of the transcript JSONL it
 * writes itself — the same file the run-state tailer already watches, so this
 * costs no extra I/O.
 *
 * Two deterministic signals bracket every job:
 *
 *  - **Start** — the `tool_result` row for the launching tool call carries the
 *    CLI's own task id: `toolUseResult.backgroundTaskId` for a background
 *    `Bash`, `.taskId` for a `Monitor`, `.agentId` for an async sub-agent. The
 *    command and description come from the paired `tool_use` row.
 *  - **End** — a `<task-notification>` block naming the same id, plus its final
 *    `<status>`.
 *
 * Started minus ended = still running. Deliberately NOT corroborated against
 * the `[exited with code N]` marker in `/private/tmp/claude-<uid>/…/tasks/`:
 * that tree survives the CLI it belongs to, so a stale file there reads
 * identically to a live job.
 */

/** Only these tool names can launch something that outlives the turn. */
const BACKGROUND_TOOL_KINDS: Record<string, BackgroundJobKind> = {
  Bash: 'bash',
  Monitor: 'monitor',
  Agent: 'agent',
  Task: 'agent',
};

const TASK_ID_RE = /<task-id>\s*([^<\s]+)\s*<\/task-id>/;
const STATUS_RE = /<status>\s*([^<\s]+)\s*<\/status>/;
const OUTPUT_FILE_RE = /<output-file>\s*([^<]+?)\s*<\/output-file>/;
const SUMMARY_RE = /<summary>\s*([\s\S]*?)\s*<\/summary>/;
/** The CLI states a background shell's output path inside its result text. */
const OUTPUT_PATH_IN_TEXT_RE = /(\/\S+\.output)\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function rowTimestamp(row: Record<string, unknown>): number {
  const parsed = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Flattens a tool_result's `content`, which is either a string or text blocks. */
function flattenResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const text = optionalString(block.text);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

/**
 * The text of a completion notification, or null when this row isn't one.
 *
 * The notification lands in three unrelated row shapes, so each is matched on
 * its own discriminant rather than by searching the raw line. A plain substring
 * test would also match rows where an agent merely *discusses* the tag — a
 * `tool_use` input, an assistant message, a file being written — and would
 * close jobs that are still running.
 */
function notificationText(row: Record<string, unknown>): string | null {
  if (row.type === 'queue-operation') {
    return optionalString(row.content) ?? null;
  }
  if (row.type === 'attachment') {
    const attachment = row.attachment;
    if (!isRecord(attachment) || attachment.commandMode !== 'task-notification') return null;
    return optionalString(attachment.prompt) ?? null;
  }
  if (row.type === 'user') {
    const origin = row.origin;
    if (!isRecord(origin) || origin.kind !== 'task-notification') return null;
    const message = row.message;
    if (!isRecord(message)) return null;
    // A genuine notification is delivered as a bare string prompt. Block arrays
    // are ordinary conversation content that happens to mention the tag.
    return optionalString(message.content) ?? null;
  }
  return null;
}

function terminalStatus(raw: string | undefined): BackgroundJobStatus {
  switch (raw) {
    case 'failed':
      return 'failed';
    case 'killed':
    case 'stopped':
      return 'stopped';
    default:
      // `completed` and anything the CLI adds later: the job is over and we have
      // no evidence it went wrong.
      return 'completed';
  }
}

type LaunchingCall = {
  kind: BackgroundJobKind;
  command?: string;
  description?: string;
};

/** Pure classifier over raw transcript text. Exported shape is insertion-ordered. */
export function parseClaudeBackgroundJobs(raw: string): BackgroundJob[] {
  const calls = new Map<string, LaunchingCall>();
  const jobs = new Map<string, BackgroundJob>();

  for (const line of iterateLines(raw)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) continue;
      row = parsed;
    } catch {
      continue;
    }

    // Sub-agent transcripts are inlined into the parent file; their own tool
    // calls belong to that agent's run, not to this session.
    if (row.isSidechain === true) continue;

    const notification = notificationText(row);
    if (notification) {
      const taskId = TASK_ID_RE.exec(notification)?.[1];
      // A notification for an unknown id means its launch row is not in this
      // file (compaction, a forked transcript). Nothing to close, and inventing
      // an entry would list a job we can say nothing about.
      const job = taskId ? jobs.get(taskId) : undefined;
      if (job) {
        job.status = terminalStatus(STATUS_RE.exec(notification)?.[1]);
        job.endedAt = rowTimestamp(row) || job.endedAt;
        job.outputPath = OUTPUT_FILE_RE.exec(notification)?.[1] ?? job.outputPath;
        job.summary = SUMMARY_RE.exec(notification)?.[1] || job.summary;
      }
      continue;
    }

    const message = row.message;
    const content = isRecord(message) ? message.content : undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === 'tool_use') {
          const name = optionalString(block.name);
          const id = optionalString(block.id);
          const kind = name ? BACKGROUND_TOOL_KINDS[name] : undefined;
          if (!id || !kind) continue;
          const input = isRecord(block.input) ? block.input : {};
          calls.set(id, {
            kind,
            command: optionalString(input.command),
            description: optionalString(input.description),
          });
          continue;
        }
        if (block.type !== 'tool_result') continue;
        const toolUseId = optionalString(block.tool_use_id);
        const result = row.toolUseResult;
        if (!toolUseId || !isRecord(result)) continue;
        const launched = launchedJob(
          result,
          calls.get(toolUseId),
          flattenResultText(block.content)
        );
        if (!launched) continue;
        // Ids are unique per session; a repeat means we already have it.
        if (jobs.has(launched.taskId)) continue;
        jobs.set(launched.taskId, { ...launched, startedAt: rowTimestamp(row) });
      }
    }
  }

  return [...jobs.values()];
}

/**
 * Recognises the launch of a detached job from a tool result. Returns null for
 * ordinary foreground results, which is the overwhelming majority.
 */
function launchedJob(
  result: Record<string, unknown>,
  call: LaunchingCall | undefined,
  resultText: string
): Omit<BackgroundJob, 'startedAt'> | null {
  // An async sub-agent reports its id and output file directly.
  const agentId = optionalString(result.agentId);
  if (agentId) {
    return {
      taskId: agentId,
      kind: 'agent',
      status: 'running',
      description: optionalString(result.description) ?? call?.description,
      outputPath: optionalString(result.outputFile) ?? pathFromText(resultText),
    };
  }

  // A background shell; its path is only stated in the result text.
  const backgroundTaskId = optionalString(result.backgroundTaskId);
  if (backgroundTaskId) {
    return {
      taskId: backgroundTaskId,
      kind: call?.kind === 'monitor' ? 'monitor' : 'bash',
      status: 'running',
      command: call?.command,
      description: call?.description,
      outputPath: pathFromText(resultText),
    };
  }

  // A Monitor watch. `taskId` alone is too generic to key on — unrelated results
  // carry one too — so require the launching call to have been a Monitor.
  const taskId = optionalString(result.taskId);
  if (taskId && call?.kind === 'monitor') {
    return {
      taskId,
      kind: 'monitor',
      status: 'running',
      command: call.command,
      description: call.description,
      outputPath: pathFromText(resultText),
    };
  }

  return null;
}

function pathFromText(text: string): string | undefined {
  return OUTPUT_PATH_IN_TEXT_RE.exec(text)?.[1];
}

/**
 * Retires jobs that a previous CLI process owned.
 *
 * Claude Code's background shells are children of the CLI, so they die with it,
 * and a resumed session never writes their completion notification. When the
 * transcript is reused across resumes those launch rows would otherwise stay
 * open forever and pin a phantom "background running" indicator — the same
 * class of bug as a zombie `working` status. A job that started before this
 * PTY session did cannot still be running; we just never saw how it ended.
 */
export function retireBackgroundJobsFromEarlierRuns(
  jobs: readonly BackgroundJob[],
  sessionStartedAtMs: number
): BackgroundJob[] {
  if (!Number.isFinite(sessionStartedAtMs) || sessionStartedAtMs <= 0) return [...jobs];
  return jobs.map((job) =>
    job.status === 'running' && job.startedAt > 0 && job.startedAt < sessionStartedAtMs
      ? { ...job, status: 'stopped' as BackgroundJobStatus }
      : job
  );
}
