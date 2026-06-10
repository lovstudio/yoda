import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { useQuery } from '@tanstack/react-query';
import {
  Brain,
  ChevronRight,
  Cpu,
  FileText,
  Info,
  Plug,
  Search,
  Sparkles,
  Users,
  Webhook,
  Wrench,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeMemoryFile,
  ClaudeSessionContext,
  ClaudeSessionPrompt,
  CodexDynamicTool,
  CodexMemoryFile,
  CodexSessionContext,
  ContextSkill,
} from '@shared/conversations';
import {
  FileActionsContextMenu,
  FileActionsDropdown,
} from '@renderer/features/tasks/components/file-actions';
import {
  PersistedDetails,
  usePersistedDisclosure,
} from '@renderer/features/tasks/components/persisted-disclosure';
import { HooksPanel } from '@renderer/features/tasks/hooks/hooks-panel';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';

const CONTEXT_REFRESH_MS = 3_000;
const CONTEXT_PANEL_SECTION_IDS = {
  llmContext: 'llm-context',
  memory: 'memory',
  tools: 'tools',
  mcpServers: 'mcp-servers',
  skills: 'skills',
  agentsAvailable: 'agents-available',
  hooks: 'hooks',
} as const;

type ContextPanelSectionId =
  (typeof CONTEXT_PANEL_SECTION_IDS)[keyof typeof CONTEXT_PANEL_SECTION_IDS];

/**
 * The harness blinds (agent runtime view: memory, tools, MCP, skills, agents,
 * hooks) — accordion items meant to live inside the Session panel's root.
 */
export const HarnessSections = observer(function HarnessSections({
  active = true,
}: {
  /** When false, live sub-panels (e.g. hooks) pause their queries/subscriptions. */
  active?: boolean;
} = {}) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const { tabManager } = taskView;
  const activeConversation = tabManager.activeConversation;

  const runtimeId = activeConversation?.data.runtimeId;
  const hooksOpen =
    active && taskView.sessionPanelOpenSectionIds.includes(CONTEXT_PANEL_SECTION_IDS.hooks);

  return (
    <>
      {!activeConversation ? (
        <Section
          id={CONTEXT_PANEL_SECTION_IDS.llmContext}
          title={t('tasks.panel.llmContext')}
          icon={<Cpu className="size-3.5" />}
        >
          <Empty>{t('tasks.panel.noActiveConversation')}</Empty>
        </Section>
      ) : runtimeId === 'claude' ? (
        <ClaudeContextSections cwd={provisioned.path} sessionId={activeConversation.data.id} />
      ) : runtimeId === 'codex' ? (
        <CodexContextSections
          cwd={provisioned.path}
          conversationId={activeConversation.data.id}
          conversationTitle={activeConversation.data.title}
          conversationCreatedAt={activeConversation.data.createdAt ?? null}
        />
      ) : (
        <Section
          id={CONTEXT_PANEL_SECTION_IDS.llmContext}
          title={t('tasks.panel.llmContext')}
          icon={<Cpu className="size-3.5" />}
        >
          <Empty>{t('tasks.panel.contextUnsupported')}</Empty>
        </Section>
      )}

      <Section
        id={CONTEXT_PANEL_SECTION_IDS.hooks}
        title={t('tasks.sessionPanel.hooks')}
        icon={<Webhook className="size-3.5" />}
        bare
      >
        <HooksPanel active={hooksOpen} chromeless />
      </Section>
    </>
  );
});

function ClaudeContextSections({ cwd, sessionId }: { cwd: string; sessionId: string }) {
  const { t } = useTranslation();
  const { data, isPending } = useQuery<ClaudeSessionContext | null>({
    queryKey: ['claudeSessionContext', cwd, sessionId],
    queryFn: () => rpc.conversations.getClaudeSessionContext(cwd, sessionId),
    refetchInterval: CONTEXT_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  if (!data && isPending) {
    return (
      <Section
        id={CONTEXT_PANEL_SECTION_IDS.llmContext}
        title={t('tasks.panel.llmContext')}
        icon={<Cpu className="size-3.5" />}
      >
        <Empty>{t('common.loading')}</Empty>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section
        id={CONTEXT_PANEL_SECTION_IDS.llmContext}
        title={t('tasks.panel.llmContext')}
        icon={<Cpu className="size-3.5" />}
      >
        <Empty>{t('tasks.panel.noTranscript')}</Empty>
      </Section>
    );
  }

  return (
    <>
      <MemorySection
        files={data.memoryFiles}
        systemPromptHint={t('tasks.panel.systemPromptHint')}
      />
      <ToolsSection tools={data.tools.filter((t) => !t.startsWith('mcp__'))} />
      <McpSection
        servers={data.mcpServers}
        mcpTools={data.tools.filter((t) => t.startsWith('mcp__'))}
      />
      <SkillsSection skills={data.skills} content={data.skillsListing} />
      <AgentsSection agents={data.agents} />
    </>
  );
}

function CodexContextSections({
  cwd,
  conversationId,
  conversationTitle,
  conversationCreatedAt,
}: {
  cwd: string;
  conversationId: string;
  conversationTitle: string;
  conversationCreatedAt: string | null;
}) {
  const { t } = useTranslation();
  const { data, isPending } = useQuery<CodexSessionContext | null>({
    queryKey: [
      'codexSessionContext',
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
    ],
    queryFn: () =>
      rpc.conversations.getCodexSessionContext(
        cwd,
        conversationId,
        conversationTitle,
        conversationCreatedAt
      ),
    refetchInterval: CONTEXT_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  if (!data && isPending) {
    return (
      <Section
        id={CONTEXT_PANEL_SECTION_IDS.llmContext}
        title={t('tasks.panel.llmContext')}
        icon={<Cpu className="size-3.5" />}
      >
        <Empty>{t('common.loading')}</Empty>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section
        id={CONTEXT_PANEL_SECTION_IDS.llmContext}
        title={t('tasks.panel.llmContext')}
        icon={<Cpu className="size-3.5" />}
      >
        <Empty>{t('tasks.panel.noTranscript')}</Empty>
      </Section>
    );
  }

  const codexTools = data.dynamicTools.filter((tool) => !isCodexMcpTool(tool));
  const codexMcpTools = data.dynamicTools.filter(isCodexMcpTool);

  return (
    <>
      <MemorySection
        files={data.memoryFiles}
        codexSystemPrompt={{
          baseInstructions: data.baseInstructions,
          developerMessages: data.developerMessages,
          sourcePath: data.rolloutPath,
        }}
      />
      <CodexDynamicToolsSection tools={codexTools} />
      <CodexMcpSection tools={codexMcpTools} />
      <SkillsSection skills={data.skills} content={data.skillsListing} />
    </>
  );
}

function isCodexMcpTool(tool: CodexDynamicTool): boolean {
  return !!tool.namespace?.trim();
}

function CodexDynamicToolsSection({ tools }: { tools: CodexDynamicTool[] }) {
  const { t } = useTranslation();
  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.tools}
      title={t('tasks.panel.tools')}
      count={tools.length}
      icon={<Wrench className="size-3.5" />}
    >
      {tools.length === 0 ? (
        <Empty>{t('tasks.panel.noTools')}</Empty>
      ) : (
        tools.map((tool) => (
          <ContextItem
            key={`${tool.namespace ?? ''}:${tool.name}`}
            icon={<Wrench className="size-3.5" />}
            label={tool.namespace ? `${tool.namespace}:${tool.name}` : tool.name}
            meta={tool.deferLoading ? t('tasks.panel.deferred') : undefined}
            text={formatCodexTool(tool)}
            renderMode="plain"
          />
        ))
      )}
    </Section>
  );
}

function CodexMcpSection({ tools }: { tools: CodexDynamicTool[] }) {
  const { t } = useTranslation();
  const serverItems = useMemo(() => {
    const items = new Map<string, CodexDynamicTool[]>();
    for (const tool of tools) {
      const serverName = tool.namespace?.trim();
      if (!serverName) continue;
      const serverTools = items.get(serverName);
      if (serverTools) serverTools.push(tool);
      else items.set(serverName, [tool]);
    }
    return [...items.entries()]
      .map(([name, serverTools]) => ({
        name,
        tools: [...serverTools].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tools]);

  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.mcpServers}
      title={t('tasks.panel.mcpServers')}
      count={serverItems.length}
      icon={<Plug className="size-3.5" />}
    >
      {serverItems.length === 0 ? (
        <Empty>{t('tasks.panel.noMcpServers')}</Empty>
      ) : (
        serverItems.map((server) => (
          <CodexMcpServerItem key={server.name} name={server.name} tools={server.tools} />
        ))
      )}
    </Section>
  );
}

function CodexMcpServerItem({ name, tools }: { name: string; tools: CodexDynamicTool[] }) {
  const { t } = useTranslation();
  return (
    <PersistedDetails
      id={`context:mcp:${name}`}
      className="min-w-0 rounded-sm border border-dashed border-border/80 bg-background-1/40 px-1.5 py-1"
      summary={
        <summary className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-[11px]">
          <Plug className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={name}>
            {name}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-foreground-passive">
            {tools.length}
          </span>
        </summary>
      }
    >
      <div className="mt-1.5 flex min-w-0 flex-col gap-1.5">
        {tools.map((tool) => (
          <ContextItem
            key={`${name}:${tool.name}`}
            icon={<Wrench className="size-3.5" />}
            label={tool.name}
            meta={tool.deferLoading ? t('tasks.panel.deferred') : undefined}
            text={formatCodexTool(tool)}
            renderMode="plain"
          />
        ))}
      </div>
    </PersistedDetails>
  );
}

type CodexSystemPrompt = {
  baseInstructions: string | null;
  developerMessages: ClaudeSessionPrompt[];
  sourcePath?: string | null;
};

/**
 * Unified "Memory" chapter: the system prompt and the memory files (CLAUDE.md /
 * AGENTS.md) live together, since both are the durable instructions the model
 * carries into every turn. Claude does not log its base system prompt, so it
 * contributes only a hint; Codex contributes base instructions + developer
 * messages read from the rollout transcript.
 */
function MemorySection({
  files,
  systemPromptHint,
  codexSystemPrompt,
}: {
  files: Array<ClaudeMemoryFile | CodexMemoryFile>;
  systemPromptHint?: string;
  codexSystemPrompt?: CodexSystemPrompt;
}) {
  const { t } = useTranslation();
  const base = codexSystemPrompt?.baseInstructions;
  const developerMessages = codexSystemPrompt?.developerMessages ?? [];
  const sourcePath = codexSystemPrompt?.sourcePath ?? undefined;
  const hasSystemPrompt =
    Boolean(base) || developerMessages.length > 0 || Boolean(systemPromptHint);

  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.memory}
      title={t('tasks.panel.memory')}
      icon={<Brain className="size-3.5" />}
      count={files.length}
      hint={systemPromptHint ?? t('tasks.panel.codexSystemPromptHint')}
    >
      {hasSystemPrompt ? (
        <SubGroup label={t('tasks.panel.systemPrompt')}>
          {base ? (
            <ContextItem
              icon={<Info className="size-3.5" />}
              label={t('tasks.panel.baseInstructions')}
              meta={formatBytes(base.length)}
              text={base}
              sourcePath={sourcePath}
            />
          ) : null}
          {developerMessages.map((message, index) => (
            <ContextItem
              key={message.id}
              icon={<FileText className="size-3.5" />}
              label={`${t('tasks.panel.developerMessage')} #${index + 1}`}
              meta={formatBytes(message.text.length)}
              text={message.text}
              sourcePath={sourcePath}
            />
          ))}
          {!base && developerMessages.length === 0 && systemPromptHint ? (
            <Empty>{systemPromptHint}</Empty>
          ) : null}
        </SubGroup>
      ) : null}

      <SubGroup label={t('tasks.panel.memoryFiles')}>
        {files.length === 0 ? (
          <Empty>{t('tasks.panel.noMemoryFiles')}</Empty>
        ) : (
          files.map((f) => (
            <ContextItem
              key={f.path}
              icon={<FileText className="size-3.5" />}
              label={memoryFileLabel(f, t)}
              meta={formatBytes(f.bytes)}
              text={f.content}
              sourcePath={f.path}
            />
          ))
        )}
      </SubGroup>
    </Section>
  );
}

/** A labelled cluster of context items inside a Section (e.g. system prompt vs memory files). */
function SubGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <MicroLabel className="px-0.5 text-foreground-passive/80">{label}</MicroLabel>
      {children}
    </div>
  );
}

function memoryFileLabel(
  file: ClaudeMemoryFile | CodexMemoryFile,
  t: (k: string) => string
): string {
  const kindLabel = memoryFileKindLabel(file.kind, t);
  return `${kindLabel} · ${file.path}`;
}

function memoryFileKindLabel(
  kind: (ClaudeMemoryFile | CodexMemoryFile)['kind'],
  t: (k: string) => string
): string {
  switch (kind) {
    case 'global-claude':
      return t('tasks.panel.memoryGlobal');
    case 'project-claude':
      return t('tasks.panel.memoryProjectClaude');
    case 'project-agents':
      return t('tasks.panel.memoryProjectAgents');
    case 'global-codex-agents':
      return t('tasks.panel.memoryGlobalCodexAgents');
    case 'project-codex-agents':
      return t('tasks.panel.memoryProjectCodexAgents');
  }
}

function ToolsSection({ tools }: { tools: string[] }) {
  const { t } = useTranslation();
  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.tools}
      title={t('tasks.panel.tools')}
      count={tools.length}
      icon={<Wrench className="size-3.5" />}
    >
      {tools.length === 0 ? <Empty>{t('tasks.panel.noTools')}</Empty> : <ChipList items={tools} />}
    </Section>
  );
}

function McpSection({
  servers,
  mcpTools,
}: {
  servers: ClaudeSessionContext['mcpServers'];
  mcpTools: string[];
}) {
  const { t } = useTranslation();
  const toolsByServer = new Map<string, string[]>();
  for (const tool of mcpTools) {
    const rest = tool.slice('mcp__'.length);
    const sep = rest.indexOf('__');
    if (sep === -1) continue;
    const server = rest.slice(0, sep);
    const name = rest.slice(sep + 2);
    const list = toolsByServer.get(server);
    if (list) list.push(name);
    else toolsByServer.set(server, [name]);
  }
  const serverItems = servers.map((server) => ({
    name: server.name,
    instructions: server.instructions,
    tools: toolsByServer.get(server.name) ?? [],
  }));
  const knownServerNames = new Set(serverItems.map((server) => server.name));
  for (const [serverName, tools] of toolsByServer) {
    if (knownServerNames.has(serverName)) continue;
    serverItems.push({ name: serverName, instructions: '', tools });
  }
  serverItems.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.mcpServers}
      title={t('tasks.panel.mcpServers')}
      count={serverItems.length}
      icon={<Plug className="size-3.5" />}
    >
      {serverItems.length === 0 ? (
        <Empty>{t('tasks.panel.noMcpServers')}</Empty>
      ) : (
        serverItems.map((s) => {
          return (
            <McpServerItem
              key={s.name}
              name={s.name}
              instructions={s.instructions}
              tools={s.tools}
            />
          );
        })
      )}
    </Section>
  );
}

function McpServerItem({
  name,
  instructions,
  tools,
}: {
  name: string;
  instructions: string;
  tools: string[];
}) {
  return (
    <PersistedDetails
      id={`context:mcp:${name}`}
      className="min-w-0 rounded-sm border border-dashed border-border/80 bg-background-1/40 px-1.5 py-1"
      summary={
        <summary className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-[11px]">
          <Plug className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={name}>
            {name}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-foreground-passive">
            {tools.length}
          </span>
        </summary>
      }
    >
      <div className="mt-1.5 flex flex-col gap-1.5">
        {tools.length > 0 ? <ChipList items={tools} mono /> : null}
        {instructions ? (
          <MarkdownContextContent content={instructions} className="mt-1.5 max-h-56" />
        ) : null}
      </div>
    </PersistedDetails>
  );
}

function SkillsSection({ skills, content }: { skills?: ContextSkill[]; content: string | null }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const parsedSkills = useMemo(() => (content ? parseSkillListing(content) : []), [content]);
  const entries = useMemo(
    () => (skills && skills.length > 0 ? skills : parsedSkills),
    [parsedSkills, skills]
  );
  const skillTree = useMemo(() => buildSkillTree(entries), [entries]);
  const filteredSkillTree = useMemo(() => filterSkillTree(skillTree, query), [query, skillTree]);
  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.skills}
      title={t('tasks.panel.skills')}
      count={entries.length}
      icon={<Sparkles className="size-3.5" />}
    >
      {entries.length > 0 ? (
        <>
          <div className="relative flex w-full min-w-0 items-center">
            <Search className="pointer-events-none absolute left-2 size-3.5 shrink-0 text-foreground-passive" />
            <Input
              className="h-6 bg-background-1 pl-7 text-xs focus-visible:ring-1 focus-visible:ring-inset"
              placeholder={t('common.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filteredSkillTree.length > 0 ? (
            <SkillTreeList items={filteredSkillTree} isSearching={query.trim().length > 0} />
          ) : (
            <Empty>{t('tasks.panel.noMatchingSkills')}</Empty>
          )}
        </>
      ) : content ? (
        <ContextItem
          icon={<Sparkles className="size-3.5" />}
          label={t('tasks.panel.fullSkillListing')}
          meta={formatBytes(content.length)}
          text={content}
        />
      ) : (
        <Empty>{t('tasks.panel.noSkills')}</Empty>
      )}
    </Section>
  );
}

type SkillEntry = ContextSkill | { name: string; description: string };

type SkillTreeLeaf = {
  kind: 'leaf';
  id: string;
  skill: SkillEntry;
  label: string;
  fullName: string;
  segments: string[];
  searchableText: string;
};

type SkillTreeNode = {
  kind: 'node';
  id: string;
  label: string;
  children: SkillTreeItem[];
  leafCount: number;
};

type SkillTreeItem = SkillTreeLeaf | SkillTreeNode;

type MutableSkillTreeNode = {
  label: string;
  children: Map<string, MutableSkillTreeNode>;
  leaves: SkillTreeLeaf[];
};

function SkillTreeList({ items, isSearching }: { items: SkillTreeItem[]; isSearching: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {items.map((item) => (
        <SkillTreeItemView key={item.id} item={item} depth={0} isSearching={isSearching} />
      ))}
    </div>
  );
}

function SkillTreeItemView({
  item,
  depth,
  isSearching,
}: {
  item: SkillTreeItem;
  depth: number;
  isSearching: boolean;
}) {
  if (item.kind === 'leaf') {
    return <SkillContextItem skill={item.skill} label={depth === 0 ? item.fullName : item.label} />;
  }

  if (item.leafCount <= 1) {
    const leaf = getOnlySkillLeaf(item);
    if (!leaf) return null;
    const label = depth === 0 ? leaf.fullName : leaf.segments.slice(depth).join(':');
    return <SkillContextItem skill={leaf.skill} label={label || leaf.fullName} />;
  }

  return (
    <SkillTreeNodeDetails id={`context:skill:${item.id}`} isSearching={isSearching}>
      <summary className="flex h-6 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-sm px-1 text-[11px] hover:bg-background-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 text-foreground-passive transition-transform group-open/skill-tree:rotate-90" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={item.label}>
          {item.label}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-foreground-passive">
          {item.leafCount}
        </span>
      </summary>
      <div className="ml-2.5 mt-1 flex min-w-0 flex-col gap-1.5 border-l border-border/70 pl-1.5">
        {item.children.map((child) => (
          <SkillTreeItemView
            key={child.id}
            item={child}
            depth={depth + 1}
            isSearching={isSearching}
          />
        ))}
      </div>
    </SkillTreeNodeDetails>
  );
}

/**
 * Skill-tree node `<details>`. Persists its open state, but force-opens while a
 * search query is active so matches are always visible.
 */
const SkillTreeNodeDetails = observer(function SkillTreeNodeDetails({
  id,
  isSearching,
  children,
}: {
  id: string;
  isSearching: boolean;
  children: React.ReactNode;
}) {
  const [persistedOpen, setPersistedOpen] = usePersistedDisclosure(id, false);
  return (
    <details
      className="group/skill-tree min-w-0"
      open={isSearching ? true : persistedOpen}
      onToggle={(event) => {
        if (isSearching) return;
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next !== persistedOpen) setPersistedOpen(next);
      }}
    >
      {children}
    </details>
  );
});

function SkillContextItem({ skill, label }: { skill: SkillEntry; label: string }) {
  return (
    <ContextItem
      icon={<Sparkles className="size-3.5" />}
      label={label}
      text={skill.description || '(no description)'}
      sourcePath={skillSourcePath(skill)}
    />
  );
}

function buildSkillTree(entries: SkillEntry[]): SkillTreeItem[] {
  const root: MutableSkillTreeNode = {
    label: '',
    children: new Map(),
    leaves: [],
  };

  for (const skill of entries) {
    const segments = skillNameSegments(skill.name);
    const leafLabel = segments.at(-1) ?? skill.name;
    const leaf: SkillTreeLeaf = {
      kind: 'leaf',
      id: `skill:${skill.name}`,
      skill,
      label: leafLabel,
      fullName: skill.name,
      segments,
      searchableText: skillSearchText(skill),
    };
    let cursor = root;
    for (const segment of segments.slice(0, -1)) {
      const child = cursor.children.get(segment);
      if (child) {
        cursor = child;
        continue;
      }
      const next: MutableSkillTreeNode = {
        label: segment,
        children: new Map(),
        leaves: [],
      };
      cursor.children.set(segment, next);
      cursor = next;
    }
    cursor.leaves.push(leaf);
  }

  return mutableSkillNodeChildren(root, []);
}

function mutableSkillNodeChildren(node: MutableSkillTreeNode, path: string[]): SkillTreeItem[] {
  const children: SkillTreeItem[] = [];
  for (const [label, child] of node.children) {
    const childPath = [...path, label];
    const childChildren = mutableSkillNodeChildren(child, childPath);
    children.push({
      kind: 'node',
      id: `skill-node:${childPath.join(':')}`,
      label,
      children: childChildren,
      leafCount: countSkillLeaves(childChildren),
    });
  }
  children.push(...node.leaves);
  return children.sort(compareSkillTreeItems);
}

function filterSkillTree(items: SkillTreeItem[], query: string): SkillTreeItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.flatMap((item) => {
    const filtered = filterSkillTreeItem(item, normalizedQuery, false);
    return filtered ? [filtered] : [];
  });
}

function filterSkillTreeItem(
  item: SkillTreeItem,
  query: string,
  ancestorMatched: boolean
): SkillTreeItem | null {
  if (item.kind === 'leaf') {
    return ancestorMatched || item.searchableText.includes(query) ? item : null;
  }

  const selfMatched = item.label.toLowerCase().includes(query);
  const children = item.children.flatMap((child) => {
    const filtered = filterSkillTreeItem(child, query, ancestorMatched || selfMatched);
    return filtered ? [filtered] : [];
  });
  if (children.length === 0) return null;
  return {
    ...item,
    children,
    leafCount: countSkillLeaves(children),
  };
}

function countSkillLeaves(items: SkillTreeItem[]): number {
  return items.reduce((count, item) => count + (item.kind === 'leaf' ? 1 : item.leafCount), 0);
}

function getOnlySkillLeaf(item: SkillTreeItem): SkillTreeLeaf | null {
  if (item.kind === 'leaf') return item;
  for (const child of item.children) {
    const leaf = getOnlySkillLeaf(child);
    if (leaf) return leaf;
  }
  return null;
}

function compareSkillTreeItems(a: SkillTreeItem, b: SkillTreeItem): number {
  return skillTreeSortLabel(a).localeCompare(skillTreeSortLabel(b));
}

function skillTreeSortLabel(item: SkillTreeItem): string {
  return item.kind === 'leaf' ? item.fullName : item.label;
}

function skillNameSegments(name: string): string[] {
  const structuralSegments = name.split(/[:/\\]+/).filter(Boolean);
  if (structuralSegments.length > 1) return structuralSegments;

  const dashIndex = name.indexOf('-');
  if (dashIndex > 0 && dashIndex < name.length - 1) {
    return [name.slice(0, dashIndex), name.slice(dashIndex + 1)];
  }

  return [name];
}

function skillSearchText(skill: SkillEntry): string {
  const sourcePath = skillSourcePath(skill) ?? '';
  return `${skill.name}\n${skill.description}\n${sourcePath}`.toLowerCase();
}

function parseSkillListing(content: string): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  let current: { name: string; description: string } | null = null;
  for (const line of content.split('\n')) {
    const match = line.match(/^- (\S+?)(?::\s+(.*))?$/);
    if (match) {
      if (current) out.push(current);
      current = { name: match[1], description: match[2] ?? '' };
    } else if (current && line.trim()) {
      current.description += (current.description ? '\n' : '') + line;
    }
  }
  if (current) out.push(current);
  return out;
}

function skillSourcePath(
  skill: ContextSkill | { name: string; description: string }
): string | undefined {
  return 'path' in skill && typeof skill.path === 'string' ? skill.path : undefined;
}

function AgentsSection({ agents }: { agents: string[] }) {
  const { t } = useTranslation();
  return (
    <Section
      id={CONTEXT_PANEL_SECTION_IDS.agentsAvailable}
      title={t('tasks.panel.agentsAvailable')}
      count={agents.length}
      icon={<Users className="size-3.5" />}
    >
      {agents.length === 0 ? (
        <Empty>{t('tasks.panel.noAgents')}</Empty>
      ) : (
        <ChipList items={agents} mono />
      )}
    </Section>
  );
}

function ChipList({ items, mono }: { items: string[]; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className={cn(
            'inline-block max-w-full truncate rounded-sm border border-border/80 bg-muted/30 px-1.5 py-0.5 text-[10px] leading-4',
            mono && 'font-mono'
          )}
          title={item}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function formatCodexTool(tool: CodexDynamicTool): string {
  const parts: string[] = [];
  if (tool.description) parts.push(tool.description);
  if (tool.inputSchema) parts.push(`Input schema:\n${tool.inputSchema}`);
  return parts.join('\n\n') || tool.name;
}

function Section({
  id,
  title,
  count,
  icon,
  hint,
  children,
  bare,
}: {
  id: ContextPanelSectionId;
  title: string;
  count?: number;
  icon?: React.ReactNode;
  hint?: string;
  children?: React.ReactNode;
  /** Render content flush (no padded wrapper) — for panels that own their layout. */
  bare?: boolean;
}) {
  const hasContent = children !== undefined && children !== null && children !== false;

  return (
    <AccordionPrimitive.Item value={id} className="min-w-0 border-b border-border/70">
      <AccordionPrimitive.Header className="m-0 flex h-8 min-w-0 items-center pr-1.5 hover:bg-background-2">
        {hasContent ? (
          <AccordionPrimitive.Trigger className="group flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border">
            <ChevronRight className="size-3 shrink-0 text-foreground-passive transition-transform group-data-[state=open]:rotate-90" />
            <SectionTitle icon={icon} title={title} />
          </AccordionPrimitive.Trigger>
        ) : (
          <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs">
            <span className="size-3 shrink-0" />
            <SectionTitle icon={icon} title={title} />
          </div>
        )}
        <div className="flex h-full shrink-0 items-center gap-1 pr-0.5">
          {typeof count === 'number' ? (
            <span className="shrink-0 font-mono text-[10px] text-foreground-passive">{count}</span>
          ) : null}
          {hint ? <SectionHint hint={hint} /> : null}
        </div>
      </AccordionPrimitive.Header>
      {hasContent ? (
        <AccordionPrimitive.Content className="overflow-hidden border-t border-border/50 bg-background-1/20">
          {bare ? (
            children
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2">{children}</div>
          )}
        </AccordionPrimitive.Content>
      ) : null}
    </AccordionPrimitive.Item>
  );
}

function SectionTitle({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <>
      {icon ? <span className="shrink-0 text-foreground-passive">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={title}>
        {title}
      </span>
    </>
  );
}

function SectionHint({ hint }: { hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            aria-label={hint}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64 text-left leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function ContextItem({
  icon,
  label,
  meta,
  text,
  sourcePath,
  renderMode = 'markdown',
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  text: string;
  sourcePath?: string;
  renderMode?: 'markdown' | 'plain';
}) {
  const item = (
    <PersistedDetails
      id={`context:item:${label}`}
      className="group/context-item relative min-w-0 rounded-sm border border-dashed border-border/80 bg-background-1/40 px-1.5 py-1"
      summary={
        <summary className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-[11px]">
          <span className="shrink-0">{icon}</span>
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          <ContextItemTrailing meta={meta} sourcePath={sourcePath} />
        </summary>
      }
    >
      {renderMode === 'markdown' ? (
        <MarkdownContextContent content={text} className="mt-1.5 max-h-56" />
      ) : (
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground-passive">
          {text}
        </pre>
      )}
    </PersistedDetails>
  );

  if (!sourcePath) return item;
  return <FileActionsContextMenu sourcePath={sourcePath}>{item}</FileActionsContextMenu>;
}

function MarkdownContextContent({ content, className }: { content: string; className?: string }) {
  return (
    <MarkdownRenderer
      content={content}
      variant="compact"
      className={cn(
        'overflow-auto break-words text-[11px] leading-relaxed text-foreground-passive [&>*:last-child]:mb-0 [&_pre]:max-w-full',
        className
      )}
    />
  );
}

function ContextItemTrailing({ meta, sourcePath }: { meta?: string; sourcePath?: string }) {
  if (!sourcePath) {
    return meta ? (
      <span className="shrink-0 font-mono text-[10px] text-foreground-passive">{meta}</span>
    ) : null;
  }

  return (
    <span className="relative flex h-5 min-w-5 shrink-0 items-center justify-end">
      {meta ? (
        <span className="font-mono text-[10px] text-foreground-passive transition-opacity group-hover/context-item:opacity-0 group-focus-within/context-item:opacity-0">
          {meta}
        </span>
      ) : null}
      <span className="absolute right-0 flex opacity-0 transition-opacity group-hover/context-item:opacity-100 group-focus-within/context-item:opacity-100">
        <FileActionsDropdown sourcePath={sourcePath} />
      </span>
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-foreground-passive">{children}</p>;
}
