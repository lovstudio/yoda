import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import {
  classifyClaudeTranscript,
  classifyClaudeTranscriptVerdict,
  watchClaudeRunState,
} from './claude-run-state-source';

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

  it('idle after an Esc interrupt (no stop_hook_summary is written on interrupt)', () => {
    const interrupt = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
      },
    };
    expect(classifyClaudeTranscript(jsonl([stop, userMsg, assistantMsg, interrupt]))).toBe('idle');
    expect(
      classifyClaudeTranscriptVerdict(jsonl([stop, userMsg, assistantMsg, interrupt])).interrupted
    ).toBe(true);
  });

  it('idle after an Esc interrupt during tool use (cancelled tool gets an error tool_result)', () => {
    const toolUse = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'tu_1' }],
      },
    };
    const cancelled = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true }],
      },
    };
    const interrupt = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }],
      },
    };
    expect(classifyClaudeTranscript(jsonl([stop, userMsg, toolUse, cancelled, interrupt]))).toBe(
      'idle'
    );
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

  it('re-dispatches turn-started when a new prompt arrives while classification stays working', async () => {
    // Regression: a stale `working` (interrupt with no sentinel) was force-
    // cleared; the NEXT prompt keeps the classification at `working`, so a
    // state-only dedup would swallow its turn-started and the store would stay
    // idle/completed for the whole turn.
    const u1 = {
      type: 'user',
      message: { role: 'user', content: 'hi' },
      timestamp: '2026-06-10T00:00:01.000Z',
    };
    const u2 = { ...u1, timestamp: '2026-06-10T00:00:05.000Z' };
    writeTranscript('s5', [stop, u1]); // working
    const events: RunStateEvent[] = [];
    const w = watchClaudeRunState({ cwd: '/repo', conversationId: 's5' }, (e) => events.push(e));
    await waitFor(() => events.length === 1);
    writeTranscript('s5', [stop, u1, u2]); // still working, but a NEW decisive prompt row
    await waitFor(() => events.length === 2);
    w.stop();
    expect(events.map((e) => e.kind)).toEqual(['turn-started', 'turn-started']);
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

  it('forces turn-started when a pending interactive tool is answered', async () => {
    // Regression: the reducer keeps `awaiting-input` on non-forced starts, so
    // when the PostToolUse hook is missed the tailer's plain turn-started was
    // swallowed and the sidebar stayed pinned at awaiting-input after the user
    // answered an AskUserQuestion.
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
      timestamp: '2026-06-10T00:00:05.000Z',
    };
    writeTranscript('s6', [stop, userMsg, askUse]); // pending question = awaiting-input
    const events: RunStateEvent[] = [];
    const w = watchClaudeRunState({ cwd: '/repo', conversationId: 's6' }, (e) => events.push(e));
    await waitFor(() => events.some((e) => e.kind === 'awaiting-input'));
    writeTranscript('s6', [stop, userMsg, askUse, answer]); // answered → back to working
    await waitFor(() => events.some((e) => e.kind === 'turn-started'));
    w.stop();
    const started = events.find((e) => e.kind === 'turn-started');
    expect(started).toMatchObject({ kind: 'turn-started', force: true });
  });

  it('fires turn-interrupted when a working session later writes an interrupt sentinel', async () => {
    const interrupt = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
      },
    };
    writeTranscript('s4', [stop, userMsg, assistantMsg]); // working until sentinel lands
    const events: RunStateEvent[] = [];
    const w = watchClaudeRunState({ cwd: '/repo', conversationId: 's4' }, (e) => events.push(e));
    await waitFor(() => events.some((e) => e.kind === 'turn-started'));
    writeTranscript('s4', [stop, userMsg, assistantMsg, interrupt]);
    await waitFor(() => events.some((e) => e.kind === 'turn-interrupted'));
    w.stop();
    expect(events.map((e) => e.kind)).toEqual(['turn-started', 'turn-interrupted']);
  });
});
