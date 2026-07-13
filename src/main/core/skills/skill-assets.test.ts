import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditSkillDirectory,
  makeSkillKey,
  parseGitHubTreeUrl,
  writeManagedSkillManifest,
} from './skill-assets';

const temporaryDirectories: string[] = [];

async function makeTemporarySkill(): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-skill-assets-'));
  temporaryDirectories.push(directory);
  await fs.promises.writeFile(
    path.join(directory, 'SKILL.md'),
    '---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n',
    'utf8'
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))
  );
});

describe('skill assets', () => {
  it('keeps same-name skills distinct by source and locator', () => {
    const first = makeSkillKey('openai', 'review', 'https://example.test/a');
    const second = makeSkillKey('anthropic', 'review', 'https://example.test/a');
    const third = makeSkillKey('openai', 'review', 'https://example.test/b');

    expect(new Set([first, second, third]).size).toBe(3);
    expect(first).toBe(makeSkillKey('openai', 'review', 'https://example.test/a'));
  });

  it('hashes the complete package, reports scripts and ignores Yoda metadata', async () => {
    const directory = await makeTemporarySkill();
    await fs.promises.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.promises.writeFile(
      path.join(directory, 'scripts', 'run.sh'),
      '#!/bin/sh\ncurl https://example.test\n',
      'utf8'
    );

    const before = await auditSkillDirectory(directory, {
      name: 'demo',
      description: 'Demo skill',
    });
    await writeManagedSkillManifest(directory, {
      schemaVersion: 1,
      sourceKey: 'skill:local:demo:test',
      sourceUrl: `file://${directory}`,
      installedAt: new Date(0).toISOString(),
      reviewedContentHash: before.contentHash,
    });
    const after = await auditSkillDirectory(directory, {
      name: 'demo',
      description: 'Demo skill',
    });

    expect(new Set(before.files.map((file) => file.path))).toEqual(
      new Set(['SKILL.md', 'scripts/run.sh'])
    );
    expect(before.riskLevel).toBe('elevated');
    expect(before.healthIssues.map((issue) => issue.code)).toEqual(['scripted', 'network-access']);
    expect(after.contentHash).toBe(before.contentHash);
  });

  it('parses supported GitHub directory URLs', () => {
    expect(
      parseGitHubTreeUrl('https://github.com/openai/skills/tree/main/skills/.curated/docs')
    ).toEqual({
      owner: 'openai',
      repo: 'skills',
      ref: 'main',
      directory: 'skills/.curated/docs',
    });
    expect(parseGitHubTreeUrl('https://example.test/skill')).toBeNull();
  });

  it('hashes but does not inline oversized text files', async () => {
    const directory = await makeTemporarySkill();
    await fs.promises.writeFile(path.join(directory, 'large.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));

    const audit = await auditSkillDirectory(directory);
    const largeFile = audit.files.find((file) => file.path === 'large.txt');

    expect(largeFile).toEqual(
      expect.objectContaining({ binary: false, tooLarge: true, bytes: 2 * 1024 * 1024 + 1 })
    );
    expect(largeFile?.content).toBeUndefined();
    expect(audit.healthIssues.map((issue) => issue.code)).toContain('content-scan-limited');
  });
});
