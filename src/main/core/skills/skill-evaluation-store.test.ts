import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillEvaluationStore } from './skill-evaluation-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))
  );
});

describe('SkillEvaluationStore', () => {
  it('persists regression cases and results across instances', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-skill-eval-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'evaluations.json');
    const store = new SkillEvaluationStore(filePath);
    await store.saveCases('skill:demo', [
      { id: 'positive', text: 'Use demo', expectation: 'trigger' },
      { id: 'neighbor', text: 'Use another tool', expectation: 'neighbor' },
    ]);
    await store.recordResult('skill:demo', {
      caseId: 'positive',
      result: { status: 'triggered', durationMs: 12 },
      passed: true,
      runtime: 'claude',
      contentHash: 'abc',
      runAt: new Date(0).toISOString(),
    });

    const reloaded = await new SkillEvaluationStore(filePath).get('skill:demo');
    expect(reloaded.cases).toHaveLength(2);
    expect(reloaded.results).toEqual([
      expect.objectContaining({ caseId: 'positive', passed: true, contentHash: 'abc' }),
    ]);
  });

  it('removes results for deleted cases', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-skill-eval-'));
    temporaryDirectories.push(directory);
    const store = new SkillEvaluationStore(path.join(directory, 'evaluations.json'));
    await store.saveCases('skill:demo', [
      { id: 'case-1', text: 'Use demo', expectation: 'trigger' },
    ]);
    await store.recordResult('skill:demo', {
      caseId: 'case-1',
      result: { status: 'triggered', durationMs: 1 },
      passed: true,
      runtime: 'claude',
      runAt: new Date(0).toISOString(),
    });
    await store.saveCases('skill:demo', []);

    expect((await store.get('skill:demo')).results).toEqual([]);
  });

  it('invalidates results when a case definition changes', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-skill-eval-'));
    temporaryDirectories.push(directory);
    const store = new SkillEvaluationStore(path.join(directory, 'evaluations.json'));
    await store.saveCases('skill:demo', [
      { id: 'case-1', text: 'Use demo', expectation: 'trigger' },
    ]);
    await store.recordResult('skill:demo', {
      caseId: 'case-1',
      result: { status: 'triggered', durationMs: 1 },
      passed: true,
      runtime: 'claude',
      runAt: new Date(0).toISOString(),
    });

    await store.saveCases('skill:demo', [
      { id: 'case-1', text: 'Do not use demo', expectation: 'no-trigger' },
    ]);

    expect((await store.get('skill:demo')).results).toEqual([]);
  });
});
