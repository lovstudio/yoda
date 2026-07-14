import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildForkedClaudeTranscript,
  deleteClaudeTranscript,
  forkClaudeTranscript,
  getClaudeCompletedTurnTargets,
} from './claude-transcript-fork';

const SOURCE_SESSION_ID = uuid(900);
const TARGET_SESSION_ID = uuid(901);
const NOW = new Date('2026-07-14T09:10:11.123Z');

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('getClaudeCompletedTurnTargets', () => {
  it('uses the final descendant turn_duration and hides an unfinished latest turn', () => {
    const ids = fixtureIds();
    const raw = transcriptFixture(ids, { completeSecondTurn: false });

    expect([...getClaudeCompletedTurnTargets(raw)]).toEqual([[ids.firstPrompt, ids.noticeDone]]);
  });

  it('follows attachment and progress parents and exposes the latest turn after completion', () => {
    const ids = fixtureIds();
    const raw = transcriptFixture(ids, { completeSecondTurn: true });

    expect([...getClaudeCompletedTurnTargets(raw)]).toEqual([
      [ids.firstPrompt, ids.noticeDone],
      [ids.secondPrompt, ids.secondDone],
    ]);
  });
});

describe('buildForkedClaudeTranscript', () => {
  it('matches the Agent SDK fork transform through a completed turn', () => {
    const ids = fixtureIds();
    const sourceRaw = transcriptFixture(ids, {
      completeSecondTurn: true,
      includeContentReplacements: true,
      includeBackgroundNotification: false,
    });
    const generatedIds = Array.from({ length: 20 }, (_, index) => uuid(1000 + index));
    let generatedIndex = 0;

    const result = buildForkedClaudeTranscript({
      raw: sourceRaw,
      sourceSessionId: SOURCE_SESSION_ID,
      targetSessionId: TARGET_SESSION_ID,
      targetMessageId: ids.firstDone,
      createUuid: () => generatedIds[generatedIndex++],
      now: () => NOW,
    });
    const rows = parseRows(result.raw);
    const transcriptRows = rows.filter((row) => row.type !== 'content-replacement');

    // The mapping includes progress, but progress itself and non-transcript
    // metadata are never written. The UUID gap proves the SDK ordering.
    expect(transcriptRows.map((row) => row.type)).toEqual([
      'user',
      'attachment',
      'assistant',
      'system',
    ]);
    expect(transcriptRows.map((row) => row.uuid)).toEqual([
      generatedIds[0],
      generatedIds[2],
      generatedIds[3],
      generatedIds[4],
    ]);
    expect(result.copiedRowCount).toBe(4);
    expect(result.leafUuid).toBe(generatedIds[4]);
    expect(rows.some((row) => row.type === 'progress')).toBe(false);
    expect(rows.some((row) => row.type === 'file-history-snapshot')).toBe(false);
    expect(rows.some((row) => row.type === 'mode')).toBe(false);
    expect(rows.some((row) => row.uuid === ids.sidechain)).toBe(false);

    // parentUuid walks through the omitted progress row, while logicalParentUuid
    // is remapped directly, matching the SDK implementation.
    expect(transcriptRows[0].parentUuid).toBeNull();
    expect(transcriptRows[1].parentUuid).toBe(generatedIds[0]);
    expect(transcriptRows[2].parentUuid).toBe(generatedIds[2]);
    expect(transcriptRows[2].logicalParentUuid).toBe(generatedIds[0]);
    expect(transcriptRows[3].parentUuid).toBe(generatedIds[3]);

    expect(transcriptRows[0].timestamp).toBe('2026-07-14T08:00:00.000Z');
    expect(transcriptRows[1].timestamp).toBe(NOW.toISOString());
    expect(transcriptRows[2].timestamp).toBeNull();
    expect(transcriptRows[3].timestamp).toBe(NOW.toISOString());
    expect(rows.every((row) => row.sessionId === TARGET_SESSION_ID)).toBe(true);
    expect(transcriptRows.every((row) => row.isSidechain === false)).toBe(true);
    expect(transcriptRows[2]).not.toHaveProperty('teamName');
    expect(transcriptRows[2]).not.toHaveProperty('agentName');
    expect(transcriptRows[2]).not.toHaveProperty('slug');
    expect(transcriptRows[2]).not.toHaveProperty('sourceToolAssistantUUID');
    expect(transcriptRows[2].forkedFrom).toEqual({
      sessionId: SOURCE_SESSION_ID,
      messageUuid: ids.firstAssistant,
    });

    const contentReplacement = rows.at(-1);
    expect(contentReplacement).toEqual({
      type: 'content-replacement',
      sessionId: TARGET_SESSION_ID,
      replacements: [
        { toolUseId: 'tool-1', newContent: 'redacted' },
        { toolUseId: 'tool-2', newContent: 'replaced' },
      ],
      uuid: generatedIds[5],
      timestamp: NOW.toISOString(),
    });
    expect(sourceRaw).toContain(ids.secondPrompt);
  });

  it.each([
    ['the prompt itself', (ids: ReturnType<typeof fixtureIds>) => ids.firstPrompt],
    ['an intermediate response', (ids: ReturnType<typeof fixtureIds>) => ids.firstAssistant],
    ['a sidechain row', (ids: ReturnType<typeof fixtureIds>) => ids.sidechain],
    ['a running final response', (ids: ReturnType<typeof fixtureIds>) => ids.secondAssistant],
    ['a file-history UUID', (ids: ReturnType<typeof fixtureIds>) => ids.fileHistory],
    ['a missing UUID', () => uuid(9999)],
  ])('rejects %s as a restore checkpoint', (_label, selectTarget) => {
    const ids = fixtureIds();
    const raw = transcriptFixture(ids, { completeSecondTurn: false });

    expect(() =>
      buildForkedClaudeTranscript({
        raw,
        sourceSessionId: SOURCE_SESSION_ID,
        targetSessionId: TARGET_SESSION_ID,
        targetMessageId: selectTarget(ids),
      })
    ).toThrow('not a completed user turn');
  });
});

describe('forkClaudeTranscript', () => {
  it('leaves the source unchanged and creates the destination exclusively', async () => {
    const ids = fixtureIds();
    const raw = transcriptFixture(ids, { completeSecondTurn: true });
    const directory = await mkdtemp(join(tmpdir(), 'yoda-claude-fork-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'source.jsonl');
    const targetPath = join(directory, 'target.jsonl');
    await writeFile(sourcePath, raw, 'utf8');

    const result = await forkClaudeTranscript({
      sourceSessionId: SOURCE_SESSION_ID,
      targetSessionId: TARGET_SESSION_ID,
      targetMessageId: ids.noticeDone,
      sourcePath,
      targetPath,
    });

    expect(result.transcriptPath).toBe(targetPath);
    expect(await readFile(sourcePath, 'utf8')).toBe(raw);
    const forkRows = parseRows(await readFile(targetPath, 'utf8'));
    expect(forkRows.every((row) => row.sessionId === TARGET_SESSION_ID)).toBe(true);
    expect(
      forkRows.every((row) => {
        const forkedFrom = row.forkedFrom as Record<string, unknown> | undefined;
        return forkedFrom === undefined || forkedFrom.sessionId === SOURCE_SESSION_ID;
      })
    ).toBe(true);
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600);

    await expect(
      forkClaudeTranscript({
        sourceSessionId: SOURCE_SESSION_ID,
        targetSessionId: TARGET_SESSION_ID,
        targetMessageId: ids.noticeDone,
        sourcePath,
        targetPath,
      })
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(sourcePath, 'utf8')).toBe(raw);

    await deleteClaudeTranscript({ sessionId: TARGET_SESSION_ID, targetPath });
    await deleteClaudeTranscript({ sessionId: TARGET_SESSION_ID, targetPath });
    await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sourcePath, 'utf8')).toBe(raw);
  });
});

function transcriptFixture(
  ids: ReturnType<typeof fixtureIds>,
  {
    completeSecondTurn,
    includeContentReplacements = false,
    includeBackgroundNotification = true,
  }: {
    completeSecondTurn: boolean;
    includeContentReplacements?: boolean;
    includeBackgroundNotification?: boolean;
  }
): string {
  const rows: Array<Record<string, unknown> | string | null> = [
    '{malformed',
    null,
    { type: 'mode', sessionId: SOURCE_SESSION_ID, mode: 'default' },
    userRow(ids.firstPrompt, null, 'First prompt', {
      timestamp: '2026-07-14T08:00:00.000Z',
    }),
    {
      type: 'progress',
      uuid: ids.progress,
      parentUuid: ids.firstPrompt,
      sessionId: SOURCE_SESSION_ID,
      timestamp: '2026-07-14T08:00:01.000Z',
    },
    {
      type: 'attachment',
      uuid: ids.attachment,
      parentUuid: ids.progress,
      sessionId: SOURCE_SESSION_ID,
      attachment: { type: 'file', path: '/tmp/context.txt' },
    },
    assistantRow(ids.firstAssistant, ids.attachment, 'First answer', false, {
      timestamp: null,
      logicalParentUuid: ids.firstPrompt,
      teamName: 'source-team',
      agentName: 'source-agent',
      slug: 'source-slug',
      sourceToolAssistantUUID: ids.firstPrompt,
    }),
    systemDoneRow(ids.firstDone, ids.firstAssistant),
    assistantRow(ids.sidechain, ids.firstAssistant, 'Subagent answer', true),
  ];
  if (includeBackgroundNotification) {
    rows.push(
      userRow(
        ids.notice,
        ids.firstDone,
        '<task-notification><task-id>background</task-id><status>completed</status></task-notification>'
      ),
      assistantRow(ids.noticeAssistant, ids.notice, 'Background task incorporated'),
      systemDoneRow(ids.noticeDone, ids.noticeAssistant)
    );
  }
  rows.push(
    {
      type: 'system',
      subtype: 'turn_duration',
      uuid: ids.orphanDone,
      parentUuid: uuid(8888),
      sessionId: SOURCE_SESSION_ID,
    },
    {
      type: 'file-history-snapshot',
      uuid: ids.fileHistory,
      messageId: ids.noticeDone,
      sessionId: SOURCE_SESSION_ID,
    },
    userRow(
      ids.secondPrompt,
      includeBackgroundNotification ? ids.noticeDone : ids.firstDone,
      'Second prompt'
    ),
    assistantRow(ids.secondAssistant, ids.secondPrompt, 'Still streaming')
  );
  if (completeSecondTurn) rows.push(systemDoneRow(ids.secondDone, ids.secondAssistant));
  if (includeContentReplacements) {
    rows.push(
      {
        type: 'content-replacement',
        sessionId: SOURCE_SESSION_ID,
        replacements: [{ toolUseId: 'tool-1', newContent: 'redacted' }],
      },
      {
        type: 'content-replacement',
        sessionId: uuid(7777),
        replacements: [{ toolUseId: 'wrong-session', newContent: 'ignored' }],
      },
      {
        type: 'content-replacement',
        sessionId: SOURCE_SESSION_ID,
        replacements: [{ toolUseId: 'tool-2', newContent: 'replaced' }],
      }
    );
  }
  return `${rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n')}\n`;
}

function userRow(
  id: string,
  parentUuid: string | null,
  text: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'user',
    uuid: id,
    parentUuid,
    sessionId: SOURCE_SESSION_ID,
    isSidechain: false,
    message: { role: 'user', content: text },
    ...extra,
  };
}

function assistantRow(
  id: string,
  parentUuid: string,
  text: string,
  isSidechain = false,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: id,
    parentUuid,
    sessionId: SOURCE_SESSION_ID,
    isSidechain,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  };
}

function systemDoneRow(id: string, parentUuid: string): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'turn_duration',
    uuid: id,
    parentUuid,
    sessionId: SOURCE_SESSION_ID,
    isSidechain: false,
    timestamp: '2026-07-14T08:00:02.000Z',
  };
}

function fixtureIds() {
  return {
    firstPrompt: uuid(1),
    progress: uuid(2),
    attachment: uuid(3),
    firstAssistant: uuid(4),
    firstDone: uuid(5),
    sidechain: uuid(6),
    notice: uuid(7),
    noticeAssistant: uuid(8),
    noticeDone: uuid(9),
    orphanDone: uuid(10),
    fileHistory: uuid(11),
    secondPrompt: uuid(12),
    secondAssistant: uuid(13),
    secondDone: uuid(14),
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function parseRows(raw: string): Array<Record<string, unknown>> {
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
