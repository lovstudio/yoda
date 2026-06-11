import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import type { SkillTriggerRunResult } from '@shared/skills/types';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

/** Headless trigger runs include the user's global hooks, so allow plenty. */
const RUN_TIMEOUT_MS = 120_000;
/** Defensive cap; the renderer also paces its own calls. */
const MAX_CONCURRENT_RUNS = 3;

let activeRuns = 0;
const waitQueue: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
const activeChildren = new Set<ChildProcessWithoutNullStreams>();

/**
 * Run one trigger-test query: spawn headless Claude Code with stream-json
 * output and decide from the event stream whether the skill was invoked.
 * The process is killed as soon as a Skill tool call is observed (early stop)
 * to keep token cost down; `--max-turns 1` bounds the run otherwise.
 */
export async function runSkillTriggerQuery(input: {
  query: string;
  /** Names that count as "this skill": directory id and frontmatter name. */
  skillNames: string[];
}): Promise<SkillTriggerRunResult> {
  await acquireSlot();
  try {
    return await spawnTriggerRun(input);
  } finally {
    releaseSlot();
  }
}

/** Kill all in-flight trigger runs and flush queued ones. */
export function cancelSkillTriggerRuns(): void {
  for (const waiter of waitQueue.splice(0)) {
    waiter.reject(new Error('Trigger test cancelled.'));
  }
  for (const child of activeChildren) {
    child.kill();
  }
}

function acquireSlot(): Promise<void> {
  if (activeRuns < MAX_CONCURRENT_RUNS) {
    activeRuns += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    waitQueue.push({
      resolve: () => {
        activeRuns += 1;
        resolve();
      },
      reject,
    });
  });
}

function releaseSlot(): void {
  activeRuns -= 1;
  waitQueue.shift()?.resolve();
}

function spawnTriggerRun(input: {
  query: string;
  skillNames: string[];
}): Promise<SkillTriggerRunResult> {
  const candidates = input.skillNames.map(normalizeSkillName).filter(Boolean);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(
      'claude',
      ['-p', input.query, '--output-format', 'stream-json', '--verbose', '--max-turns', '1'],
      {
        cwd: os.tmpdir(),
        env: buildExternalToolEnv(),
        shell: false,
        windowsHide: true,
      }
    );
    activeChildren.add(child);

    let settled = false;
    let sawResultEvent = false;
    let timedOut = false;
    let lineBuffer = '';
    let stderrTail = '';

    const settle = (result: Omit<SkillTriggerRunResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      child.kill();
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, RUN_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf8');
      let newlineIndex = lineBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line) handleStreamLine(line);
        newlineIndex = lineBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2_000);
    });

    child.on('error', (error) => {
      settle({ status: 'error', error: error.message });
    });

    child.on('close', () => {
      if (settled) return;
      if (timedOut) {
        settle({ status: 'timeout', error: 'Trigger run timed out.' });
      } else if (sawResultEvent) {
        settle({ status: 'not-triggered' });
      } else {
        settle({ status: 'error', error: stderrTail.trim() || 'Claude CLI exited early.' });
      }
    });

    function handleStreamLine(line: string) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }

      if (event.type === 'result') {
        // A result event (including error_max_turns) means the first turn
        // finished without invoking the skill.
        sawResultEvent = true;
        settle({ status: 'not-triggered' });
        return;
      }

      if (event.type !== 'assistant') return;
      const message = event.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        const toolUse = block as { type?: string; name?: string; input?: { skill?: unknown } };
        if (toolUse.type !== 'tool_use' || toolUse.name !== 'Skill') continue;
        const invoked = typeof toolUse.input?.skill === 'string' ? toolUse.input.skill : '';
        const normalized = normalizeSkillName(invoked);
        const matched =
          candidates.includes(normalized) || candidates.includes(lastSegment(normalized));
        settle({
          status: matched ? 'triggered' : 'other-skill',
          matchedSkill: invoked || undefined,
        });
        return;
      }
    }
  });
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

/** Plugin-namespaced invocations look like "plugin:skill"; match the tail. */
function lastSegment(name: string): string {
  const index = name.lastIndexOf(':');
  return index === -1 ? name : name.slice(index + 1);
}
