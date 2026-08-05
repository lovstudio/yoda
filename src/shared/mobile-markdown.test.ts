import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks, tokenizeInlineMarkdown } from '../../apps/mobile/src/markdown';

describe('mobile markdown rendering model', () => {
  it('parses a GFM table as structured mobile content', () => {
    const blocks = parseMarkdownBlocks(`结论如下：

| 选项 | 适合度 | 判断 |
|---|:---:|---|
| Sony A7M4 | **9/10** | 全画幅、恒定 F2.8，成功率最高 |
| 等效 75mm | 6/10 | 人像味道好，但构图和距离受限 |`);

    expect(blocks).toEqual([
      { kind: 'paragraph', text: '结论如下：' },
      {
        kind: 'table',
        headers: ['选项', '适合度', '判断'],
        rows: [
          ['Sony A7M4', '**9/10**', '全画幅、恒定 F2.8，成功率最高'],
          ['等效 75mm', '6/10', '人像味道好，但构图和距离受限'],
        ],
      },
    ]);
  });

  it('keeps escaped and inline-code pipes inside table cells', () => {
    const [table] = parseMarkdownBlocks(`| 名称 | 值 |
| --- | --- |
| A \\| B | \`x | y\` |`);

    expect(table).toEqual({
      kind: 'table',
      headers: ['名称', '值'],
      rows: [['A | B', '`x | y`']],
    });
  });

  it('does not turn ordinary pipe-delimited prose into a table', () => {
    expect(parseMarkdownBlocks('alpha | beta\nnot a divider')).toEqual([
      { kind: 'paragraph', text: 'alpha | beta\nnot a divider' },
    ]);
  });

  it('preserves inline emphasis used by table cells', () => {
    expect(tokenizeInlineMarkdown('推荐 **9/10**')).toEqual([
      { kind: 'text', text: '推荐 ' },
      { kind: 'bold', text: '9/10' },
    ]);
  });
});
