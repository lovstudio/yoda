import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import {
  buildSessionPromptTree,
  type SessionPromptHistory,
} from '@renderer/features/tasks/conversations/session-prompt-tree-model';
import type { ConversationPromptLocation } from '@renderer/features/tasks/conversations/use-conversation-prompt-restore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'tasks.sessionInfo.restoreContextAtPrompt') {
        return `切入第 ${String(values?.index)} 条`;
      }
      if (key === 'tasks.bottomPanel.sessionTreeLabel') return '会话路径树';
      if (key === 'tasks.bottomPanel.sessionBranchFromHere') return '从这里继续';
      if (key === 'tasks.bottomPanel.sessionCurrentNode') return '当前节点';
      if (key === 'tasks.bottomPanel.sessionCurrentBranch') return '当前分支';
      if (key === 'tasks.bottomPanel.sessionOpenBranch') {
        return `打开分支 ${String(values?.title)}`;
      }
      if (key === 'tasks.bottomPanel.sessionRestoreBranch') {
        return `恢复分支 ${String(values?.title)}`;
      }
      if (key === 'tasks.bottomPanel.sessionCurrent') return '当前';
      if (key === 'tasks.bottomPanel.sessionSwitch') return '切换';
      if (key === 'tasks.archivedSession.readOnly') return '已归档';
      if (key === 'tasks.bottomPanel.sessionCheckpointPending') return '暂无检查点';
      if (key === 'tasks.panel.noPrompts') return '暂无会话';
      if (key === 'common.loading') return '加载中';
      return key;
    },
  }),
}));

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex',
    title: id,
    createdAt: '2026-07-15T00:00:00.000Z',
    lastInteractedAt: '2026-07-15T00:00:00.000Z',
    isInitialConversation: false,
    ...overrides,
  };
}

function prompt(id: string, text: string, restorable = true): ClaudeSessionPrompt {
  return {
    id,
    text,
    timestamp: '2026-07-15T00:00:00.000Z',
    restoreTarget: restorable ? { kind: 'codex-turn', turnId: `turn-${id}` } : undefined,
  };
}

function history(
  conversation: Conversation,
  prompts: readonly ClaudeSessionPrompt[]
): SessionPromptHistory {
  return { conversation, prompts };
}

function branchedFixture() {
  const root = conversation('root', { title: '根路径' });
  const current = conversation('current', {
    title: '当前路径',
    createdAt: '2026-07-15T00:01:00.000Z',
    forkedFromConversationId: root.id,
    forkedFromPromptIndex: 1,
  });
  const liveSibling = conversation('live-sibling', {
    title: '活跃兄弟路径',
    createdAt: '2026-07-15T00:02:00.000Z',
    forkedFromConversationId: root.id,
    forkedFromPromptIndex: 1,
  });
  const archivedSibling = conversation('archived-sibling', {
    title: '归档兄弟路径',
    createdAt: '2026-07-15T00:03:00.000Z',
    archivedAt: '2026-07-15T00:04:00.000Z',
    forkedFromConversationId: root.id,
    forkedFromPromptIndex: 1,
  });

  const rootForkPrompt = prompt('root-fork', '根分叉点');
  const tree = buildSessionPromptTree(
    [
      history(root, [
        prompt('root-start', '根起点', false),
        rootForkPrompt,
        prompt('root-next', '根继续'),
      ]),
      history(current, [
        prompt('current-copy-start', '不可切入副本', false),
        prompt('current-copy-fork', '当前复制分叉点', false),
        prompt('current-next', '当前继续'),
      ]),
      history(liveSibling, [
        prompt('live-copy-start', '活跃兄弟副本起点', false),
        prompt('live-copy-fork', '活跃兄弟副本分叉点', false),
        prompt('live-next', '活跃兄弟继续'),
      ]),
      history(archivedSibling, [
        prompt('archived-copy-start', '归档兄弟副本起点', false),
        prompt('archived-copy-fork', '归档兄弟副本分叉点', false),
        prompt('archived-next', '归档兄弟继续'),
      ]),
    ],
    current.id
  );

  if (!tree) throw new Error('Expected a prompt tree for the active lineage');
  return { tree, root, rootForkPrompt, current, liveSibling, archivedSibling };
}

describe('SessionPromptTreeView', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onRestorePrompt = vi.fn<(location: ConversationPromptLocation) => void>();
  let onOpenConversation = vi.fn<(conversation: Conversation) => Promise<void>>();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onRestorePrompt = vi.fn<(location: ConversationPromptLocation) => void>();
    onOpenConversation = vi.fn<(conversation: Conversation) => Promise<void>>(async () => {});
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderFixture(fixture = branchedFixture()) {
    const { SessionPromptTreeView } = await import(
      '@renderer/features/tasks/conversations/session-prompt-tree'
    );
    await act(async () => {
      root.render(
        createElement(SessionPromptTreeView, {
          tree: fixture.tree,
          isLoading: false,
          activeConversationIds: new Set([
            fixture.root.id,
            fixture.current.id,
            fixture.liveSibling.id,
          ]),
          restoringPrompt: null,
          onRestorePrompt,
          onOpenConversation,
        })
      );
    });
    return fixture;
  }

  it('显示当前路径、兄弟路径和分支端点，并标记当前树路径', async () => {
    await renderFixture();

    const tree = host.querySelector('[role="tree"][aria-label="会话路径树"]');
    expect(tree).not.toBeNull();
    expect(tree?.textContent).toContain('当前继续');
    expect(tree?.textContent).toContain('活跃兄弟继续');
    expect(tree?.textContent).toContain('归档兄弟继续');
    expect(host.querySelector('button[aria-label="当前分支"]')).toBeNull();
    expect(host.querySelector('button[aria-label="打开分支 活跃兄弟路径"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="恢复分支 归档兄弟路径"]')).not.toBeNull();

    const currentNode = host.querySelector('[role="treeitem"][title="当前继续"]');
    expect(currentNode?.getAttribute('aria-current')).toBe('page');
    expect(currentNode?.textContent).toContain('当前节点');
    expect(
      host.querySelector('[role="treeitem"][title="活跃兄弟继续"]')?.hasAttribute('aria-current')
    ).toBe(false);

    const unrestorable = host.querySelector('[role="treeitem"][title="不可切入副本"]');
    expect(unrestorable).not.toBeNull();
    expect(unrestorable?.querySelector('button')).toBeNull();
  });

  it('点击逻辑 prompt 时传出 preferredRestoreAlias 的显式会话和完整索引', async () => {
    const fixture = await renderFixture();
    const logicalPrompt = host.querySelector('[role="treeitem"][title="当前复制分叉点"]');
    expect(logicalPrompt?.textContent).toContain('从这里继续');
    const restore = logicalPrompt?.querySelector<HTMLButtonElement>(
      'button[aria-label="切入第 2 条"]'
    );

    if (!restore) throw new Error('Expected the preferred restore alias action');
    await act(async () => restore.click());

    expect(onRestorePrompt).toHaveBeenCalledTimes(1);
    expect(onRestorePrompt).toHaveBeenCalledWith({
      conversation: fixture.root,
      prompt: fixture.rootForkPrompt,
      promptIndex: 1,
    });
  });

  it('分别用显式会话打开活跃与归档 endpoint', async () => {
    const fixture = await renderFixture();
    const liveEndpoint = host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开分支 活跃兄弟路径"]'
    );
    const archivedEndpoint = host.querySelector<HTMLButtonElement>(
      'button[aria-label="恢复分支 归档兄弟路径"]'
    );

    await act(async () => {
      liveEndpoint?.click();
      await Promise.resolve();
    });
    await act(async () => {
      archivedEndpoint?.click();
      await Promise.resolve();
    });

    expect(onOpenConversation.mock.calls.map(([item]) => item.id)).toEqual([
      fixture.liveSibling.id,
      fixture.archivedSibling.id,
    ]);
  });
});
