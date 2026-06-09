import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import { classifyClaudeTranscript, watchClaudeRunState } from './claude-run-state-source';

vi.mock('@main/core/session-title/claude-title-source', () => ({
  resolveClaudeTranscriptPath: (_cwd: string, sessionId: string) =>
    join(transcriptDir, `${sessionId}.jsonl`),
}));

let transcriptDir: string;

function jsonl(rows: Array<Record<string, unknown>>): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

const userMsg = { type: 'user', message: { role: 'user', content: 'hi' } };
const assistantMsg = { type: 'assistant', message: { role: 'assistant', content: 'ok' } };
const stop = { type: 'system', subtype: 'stop_hook_summary' };
const meta = { type: 'permission-mode' };

describe('classifyClaudeTranscript', () => {
  it('idle when the last stop comes after the last user message', () => {
    // user → assistant → stop → trailing metadata  (turn finished)
    expect(classifyClaudeTranscript(jsonl([userMsg, assistantMsg, stop, meta, meta]))).toBe('idle');
  });

  it('working when a user message comes after the last stop', () => {
    // ...stop (prev turn) → user (new prompt, not yet answered)
    expect(classifyClaudeTranscript(jsonl([userMsg, stop, userMsg]))).toBe('working');
  });

  it('working when there is a user message but no stop at all', () => {
    expect(classifyClaudeTranscript(jsonl([userMsg, assistantMsg]))).toBe('working');
  });

  it('idle when there is no user message', () => {
    expect(classifyClaudeTranscript(jsonl([meta, stop]))).toBe('idle');
  });

  it('ignores trailing metadata rows (mode/permission-mode/ai-title)', () => {
    const rows = [userMsg, stop, { type: 'mode' }, { type: 'ai-title' }, meta];
    expect(classifyClaudeTranscript(jsonl(rows))).toBe('idle');
  });

  it('ignores assistant messages — only user vs stop move the needle', () => {
    // assistant after stop must NOT count as "working"
    expect(classifyClaudeTranscript(jsonl([userMsg, stop, assistantMsg]))).toBe('idle');
  });

  it('tolerates malformed lines', () => {
    const raw = ['not json', JSON.stringify(userMsg), '', JSON.stringify(stop)].join('\n');
    expect(classifyClaudeTranscript(raw)).toBe('idle');
  });

  it('awaiting-input when an interactive tool_use has no matching tool_result', () => {
    const askUse = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'tu_1' }],
      },
    };
    expect(classifyClaudeTranscript(jsonl([userMsg, askUse]))).toBe('awaiting-input');
  });

  it('back to working once the interactive tool_use is answered (tool_result present)', () => {
    const askUse = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'tu_1' }],
      },
    };
    const answer = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1' }] },
    };
    // answered → no pending interactive tool; last user (the answer) after stop → working
    expect(classifyClaudeTranscript(jsonl([stop, userMsg, askUse, answer]))).toBe('working');
  });

  it('ExitPlanMode also counts as awaiting-input', () => {
    const plan = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'ExitPlanMode', id: 'ep_1' }],
      },
    };
    expect(classifyClaudeTranscript(jsonl([userMsg, plan]))).toBe('awaiting-input');
  });
});

describe('watchClaudeRunState (live tailer)', () => {
  beforeEach(() => {
    transcriptDir = mkdtempSync(join(tmpdir(), 'yoda-claude-state-'));
  });
  afterEach(() => {
    rmSync(transcriptDir, { recursive: true, force: true });
  });

  function writeTranscript(id: string, rows: Array<Record<string, unknown>>): void {
    writeFileSync(join(transcriptDir, `${id}.jsonl`), jsonl(rows) + '\n');
  }

  function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  it('does not fire a spurious completed for an already-idle session on attach', async () => {
    writeTranscript('s1', [userMsg, stop, meta]);
    const events: RunStateEvent[] = [];
    const w = watchClaudeRunState({ cwd: '/repo', conversationId: 's1' }, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 300));
    w.stop();
    expect(events).toEqual([]);
  });

  it('fires turn-started when the session is actively working on attach', async () => {
    writeTranscript('s2', [stop, userMsg]); // user after stop = working
    const events: RunStateEvent[] = [];
    const w = watchClaudeRunState({ cwd: '/repo', conversationId: 's2' }, (e) => events.push(e));
    await waitFor(() => events.length > 0);
    w.stop();
    expect(events[0]?.kind).toBe('turn-started');
  });

  it('fires turn-completed when a working session later goes idle', async () => {
    writeTranscript('s3', [stop, userMsg]); // working
    const events: RunStateEvent[] = [];
    const w = watchClaudeRunState({ cwd: '/repo', conversationId: 's3' }, (e) => events.push(e));
    await waitFor(() => events.some((e) => e.kind === 'turn-started'));
    writeTranscript('s3', [stop, userMsg, stop]); // turn ended
    await waitFor(() => events.some((e) => e.kind === 'turn-completed'));
    w.stop();
    expect(events.map((e) => e.kind)).toEqual(['turn-started', 'turn-completed']);
  });
});
