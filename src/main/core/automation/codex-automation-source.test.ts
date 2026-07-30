import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codexRruleToCron,
  parseCodexAutomationToml,
  readCodexAutomationSnapshots,
} from './codex-automation-source';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Codex automation source', () => {
  it('maps a daily heartbeat into a runnable Yoda cron automation', () => {
    const automation = parseCodexAutomationToml(
      [
        'version = 1',
        'id = "monitor-lovstudio-cn-icp"',
        'kind = "heartbeat"',
        'name = "每日检查 Lovstudio ICP 备案"',
        'prompt = "检查备案状态"',
        'status = "PAUSED"',
        'managed_by = "yoda"',
        'yoda_status = "ACTIVE"',
        'rrule = "FREQ=DAILY;BYHOUR=10;BYMINUTE=0;BYSECOND=0"',
        'created_at = 1785405028000',
        'updated_at = 1785405028000',
      ].join('\n')
    );

    expect(automation).toMatchObject({
      id: 'codex:monitor-lovstudio-cn-icp',
      sourceId: 'monitor-lovstudio-cn-icp',
      status: 'active',
      triggerKind: 'cron',
      cronExpr: '0 10 * * *',
      timezone: null,
      workspaceName: 'Codex',
      createdAt: '2026-07-30T09:50:28.000Z',
    });
  });

  it('supports the hourly and weekly schedules Codex commonly emits', () => {
    expect(codexRruleToCron('FREQ=HOURLY;INTERVAL=1')).toBe('0 * * * *');
    expect(codexRruleToCron('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=30;BYSECOND=0')).toBe(
      '30 9 * * 1,3,5'
    );
  });

  it('rejects schedules that would run at a different cadence after conversion', () => {
    expect(() => codexRruleToCron('FREQ=DAILY;INTERVAL=2;BYHOUR=10')).toThrow(
      'not Cron-equivalent'
    );
    expect(() => codexRruleToCron('FREQ=DAILY;BYHOUR=10;BYSECOND=30')).toThrow(
      'BYSECOND must be 0'
    );
  });

  it('reads valid files while retaining malformed source IDs for reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yoda-codex-automations-'));
    temporaryDirectories.push(root);
    const validDir = join(root, 'valid-task');
    const brokenDir = join(root, 'broken-task');
    await Promise.all([
      mkdir(validDir, { recursive: true }),
      mkdir(brokenDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(validDir, 'automation.toml'),
        [
          'id = "valid-task"',
          'name = "Valid task"',
          'prompt = "Run"',
          'status = "PAUSED"',
          'managed_by = "yoda"',
          'yoda_status = "PAUSED"',
          'rrule = "FREQ=HOURLY;INTERVAL=1"',
          'cwds = ["/Users/mark/lovstudio/coding/web"]',
        ].join('\n')
      ),
      writeFile(join(brokenDir, 'automation.toml'), 'id = "broken-task"\nstatus = "ACTIVE"\n'),
    ]);

    const result = await readCodexAutomationSnapshots(root);

    expect(result.available).toBe(true);
    expect(result.automations).toHaveLength(1);
    expect(result.automations[0]).toMatchObject({
      id: 'codex:valid-task',
      workspaceName: 'web',
      status: 'paused',
      cronExpr: '0 * * * *',
    });
    expect(result.managedIds).toEqual(
      expect.arrayContaining(['codex:valid-task', 'codex:broken-task'])
    );
    expect(result.errors).toHaveLength(1);
  });
});
