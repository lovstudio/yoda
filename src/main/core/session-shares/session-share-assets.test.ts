import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { YodaSessionShareUpload } from '@shared/session-share';
import { attachLocalSessionAssets } from './session-share-assets';

function upload(content: string): YodaSessionShareUpload {
  return {
    kind: 'yoda-session-share',
    version: 1,
    title: 'Asset sharing',
    runtimeId: 'codex',
    sessionStartedAt: null,
    blocks: [
      {
        id: 'block-1',
        role: 'assistant',
        timestamp: null,
        format: 'markdown',
        content,
      },
    ],
    truncated: false,
    assets: [],
    omittedAssetCount: 0,
  };
}

describe('attachLocalSessionAssets', () => {
  it('uploads local markdown and @path assets once and removes private paths', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'yoda-session-share-assets-'));
    const original = path.join(directory, '原图.JPG');
    const result = path.join(directory, '职业形象照版.png');
    await writeFile(original, Buffer.from('original'));
    await writeFile(result, Buffer.from('result'));

    const prepared = await attachLocalSessionAssets(
      upload(
        [
          `原图：@${original}`,
          `成品：[职业形象照版](<${result}>)`,
          `再次下载：[同一成品](<${result}>)`,
        ].join('\n\n')
      ),
      directory
    );
    const content = prepared.blocks[0]?.content ?? '';

    expect(prepared.assets).toHaveLength(2);
    expect(prepared.assets.map((asset) => asset.fileName).sort()).toEqual([
      '原图.JPG',
      '职业形象照版.png',
    ]);
    const originalId = prepared.assets.find((asset) => asset.fileName === '原图.JPG')?.id;
    const resultId = prepared.assets.find((asset) => asset.fileName === '职业形象照版.png')?.id;
    expect(content).toContain(`![原图.JPG](<yoda-share-asset:${originalId}>)`);
    expect(content).toContain(`[职业形象照版](<yoda-share-asset:${resultId}>)`);
    expect(content).toContain(`[同一成品](<yoda-share-asset:${resultId}>)`);
    expect(content).not.toContain(directory);
    expect(prepared.omittedAssetCount).toBe(0);
  });

  it('converts local image tags and missing files without exposing paths', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'yoda-session-share-images-'));
    const image = path.join(directory, 'input image.webp');
    const missing = path.join(directory, 'missing.pdf');
    await writeFile(image, Buffer.from('image'));

    const prepared = await attachLocalSessionAssets(
      upload(
        `<image name=[Image #1] path="${image}">\n\n[报告](<${missing}>)\n\n[官网](https://lovstudio.ai)`
      ),
      directory
    );
    const content = prepared.blocks[0]?.content ?? '';

    expect(prepared.assets).toHaveLength(1);
    expect(content).toContain('![Image #1](<yoda-share-asset:asset-1>)');
    expect(content).toContain('报告（本地素材未同步）');
    expect(content).toContain('[官网](https://lovstudio.ai)');
    expect(content).not.toContain(directory);
    expect(prepared.omittedAssetCount).toBe(1);
  });
});
