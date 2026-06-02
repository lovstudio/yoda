import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Hash,
  Info,
  MessageSquare,
  Pencil,
  Plug,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeMemoryFile,
  ClaudeSessionContext,
  ClaudeSessionPrompt,
} from '@shared/conversations';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  contextPanelFocusStore,
  type ContextPromptFocusTarget,
} from '@renderer/features/tasks/context-panel-focus';
import {
  buildDraftCommentsContextAction,
  buildLinkedIssueContextAction,
  buildReviewPromptContextAction,
} from '@renderer/features/tasks/conversations/context-actions';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { MicroLabel } from '@renderer/lib/ui/label';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';

const CONTEXT_REFRESH_MS = 3_000;

export const ContextPanel = observer(function ContextPanel() {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { projectId, taskId } = useTaskViewContext();
  const taskPayload = getRegisteredTaskData(projectId, taskId);
  const { tabManager } = provisioned.taskView;
  const activeConversation = tabManager.activeConversation;
  const draftComments = provisioned.draftComments;
  const { value: reviewPrompt } = useAppSettingsKey('reviewPrompt');
  const promptFocusTarget = contextPanelFocusStore.promptTarget;

  const isClaude = activeConversation?.data.providerId === 'claude';

  const linkedIssueAction = buildLinkedIssueContextAction(taskPayload?.linkedIssue);
  const draftCommentsAction = buildDraftCommentsContextAction({
    count: draftComments.count,
    formattedComments: draftComments.formattedForAgent,
  });
  const reviewPromptAction = buildReviewPromptContextAction(reviewPrompt ?? undefined);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="shrink-0 pl-4 pr-2 pt-2 pb-1">
        <MicroLabel>{t('tasks.panel.context')}</MicroLabel>
      </div>

      <div className="flex min-w-0 flex-col gap-3 px-3 pb-4">
        {!activeConversation ? (
          <Section title={t('tasks.panel.llmContext')}>
            <Empty>{t('tasks.panel.noActiveConversation')}</Empty>
          </Section>
        ) : isClaude ? (
          <ClaudeContextSections
            cwd={provisioned.path}
            sessionId={activeConversation.data.id}
            promptFocusTarget={promptFocusTarget}
          />
        ) : (
          <Section title={t('tasks.panel.llmContext')}>
            <Empty>{t('tasks.panel.claudeOnly')}</Empty>
          </Section>
        )}

        <Section title={t('tasks.panel.injectedContext')}>
          {linkedIssueAction || draftCommentsAction || reviewPromptAction ? (
            <>
              {linkedIssueAction ? (
                <ContextItem
                  icon={<Hash className="size-3.5" />}
                  label={linkedIssueAction.label}
                  text={linkedIssueAction.text}
                />
              ) : null}
              {draftCommentsAction ? (
                <ContextItem
                  icon={<MessageSquare className="size-3.5" />}
                  label={draftCommentsAction.label}
                  text={draftCommentsAction.text}
                />
              ) : null}
              {reviewPromptAction ? (
                <ContextItem
                  icon={<Pencil className="size-3.5" />}
                  label={reviewPromptAction.label}
                  text={reviewPromptAction.text}
                />
              ) : null}
            </>
          ) : (
            <Empty>{t('tasks.panel.noInjectedContext')}</Empty>
          )}
        </Section>
      </div>
    </div>
  );
});

function ClaudeContextSections({
  cwd,
  sessionId,
  promptFocusTarget,
}: {
  cwd: string;
  sessionId: string;
  promptFocusTarget: ContextPromptFocusTarget | null;
}) {
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
      <Section title={t('tasks.panel.llmContext')}>
        <Empty>{t('common.loading')}</Empty>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section title={t('tasks.panel.llmContext')}>
        <Empty>{t('tasks.panel.noTranscript')}</Empty>
      </Section>
    );
  }

  return (
    <>
      <Section title={t('tasks.panel.systemPrompt')}>
        <div className="flex items-start gap-1.5 text-xs text-foreground-passive">
          <Info className="size-3.5 shrink-0 mt-0.5" />
          <span>{t('tasks.panel.systemPromptHint')}</span>
        </div>
      </Section>

      <MemorySection files={data.memoryFiles} />
      <ToolsSection tools={data.tools.filter((t) => !t.startsWith('mcp__'))} />
      <McpSection
        servers={data.mcpServers}
        mcpTools={data.tools.filter((t) => t.startsWith('mcp__'))}
      />
      <SkillsSection content={data.skillsListing} />
      <AgentsSection agents={data.agents} />
      <SessionPromptsSection
        prompts={data.prompts}
        sessionId={sessionId}
        focusTarget={promptFocusTarget}
      />
    </>
  );
}

function MemorySection({ files }: { files: ClaudeMemoryFile[] }) {
  const { t } = useTranslation();
  return (
    <Section title={t('tasks.panel.memoryFiles')} scrollable={files.length > 0}>
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
          />
        ))
      )}
    </Section>
  );
}

function memoryFileLabel(file: ClaudeMemoryFile, t: (k: string) => string): string {
  const kindLabel =
    file.kind === 'global-claude'
      ? t('tasks.panel.memoryGlobal')
      : file.kind === 'project-claude'
        ? t('tasks.panel.memoryProjectClaude')
        : t('tasks.panel.memoryProjectAgents');
  return `${kindLabel} · ${file.path}`;
}

function ToolsSection({ tools }: { tools: string[] }) {
  const { t } = useTranslation();
  return (
    <Section
      title={t('tasks.panel.tools')}
      count={tools.length}
      icon={<Wrench className="size-3.5" />}
      scrollable={tools.length > 0}
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
      title={t('tasks.panel.mcpServers')}
      count={serverItems.length}
      icon={<Plug className="size-3.5" />}
      scrollable={serverItems.length > 0}
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
    <details className="min-w-0 rounded-sm border border-dashed border-border px-2 py-1.5">
      <summary className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-xs">
        <Plug className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-foreground-passive">
          {tools.length}
        </span>
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {tools.length > 0 ? <ChipList items={tools} mono /> : null}
        {instructions ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground-passive">
            {instructions}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function SkillsSection({ content }: { content: string | null }) {
  const { t } = useTranslation();
  const skills = content ? parseSkillListing(content) : [];
  return (
    <Section
      title={t('tasks.panel.skills')}
      count={skills.length}
      icon={<Sparkles className="size-3.5" />}
      scrollable={skills.length > 0}
    >
      {skills.length > 0 ? (
        skills.map((s) => (
          <ContextItem
            key={s.name}
            icon={<Sparkles className="size-3.5" />}
            label={s.name}
            text={s.description || '(no description)'}
          />
        ))
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

function AgentsSection({ agents }: { agents: string[] }) {
  const { t } = useTranslation();
  return (
    <Section
      title={t('tasks.panel.agentsAvailable')}
      count={agents.length}
      icon={<Users className="size-3.5" />}
      scrollable={agents.length > 0}
    >
      {agents.length === 0 ? (
        <Empty>{t('tasks.panel.noAgents')}</Empty>
      ) : (
        <ChipList items={agents} mono />
      )}
    </Section>
  );
}

function SessionPromptsSection({
  prompts,
  sessionId,
  focusTarget,
}: {
  prompts: ClaudeSessionPrompt[];
  sessionId: string;
  focusTarget: ContextPromptFocusTarget | null;
}) {
  const { t } = useTranslation();
  const targetIndex = resolvePromptTargetIndex(prompts, sessionId, focusTarget);
  return (
    <Section
      title={t('tasks.panel.sessionPrompts')}
      count={prompts.length}
      scrollable={prompts.length > 0}
    >
      {prompts.length === 0 ? (
        <Empty>{t('tasks.panel.noPrompts')}</Empty>
      ) : (
        prompts.map((p, i) => (
          <PromptItem
            key={p.id}
            index={i + 1}
            prompt={p}
            isTarget={i === targetIndex}
            focusRequestId={focusTarget?.requestId}
          />
        ))
      )}
    </Section>
  );
}

function PromptItem({
  index,
  prompt,
  isTarget,
  focusRequestId,
}: {
  index: number;
  prompt: ClaudeSessionPrompt;
  isTarget?: boolean;
  focusRequestId?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const preview = prompt.text.replace(/\s+/g, ' ').slice(0, 80);
  const timestamp = prompt.timestamp ? new Date(prompt.timestamp).toLocaleTimeString() : null;

  useEffect(() => {
    if (!isTarget) return;
    const el = ref.current;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, [focusRequestId, isTarget]);

  return (
    <details
      ref={ref}
      tabIndex={-1}
      className={cn(
        'min-w-0 rounded-sm border border-dashed border-border px-2 py-1.5 outline-none',
        isTarget && 'border-accent ring-2 ring-accent/30'
      )}
    >
      <summary className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-xs">
        <span className="shrink-0 font-mono text-[10px] text-foreground-passive">#{index}</span>
        <span className="min-w-0 flex-1 truncate" title={prompt.text}>
          {preview}
          {prompt.text.length > 80 ? '…' : ''}
        </span>
        {timestamp ? (
          <span className="shrink-0 font-mono text-[10px] text-foreground-passive">
            {timestamp}
          </span>
        ) : null}
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {prompt.text}
      </pre>
    </details>
  );
}

function resolvePromptTargetIndex(
  prompts: ClaudeSessionPrompt[],
  sessionId: string,
  focusTarget: ContextPromptFocusTarget | null
): number {
  if (!focusTarget || focusTarget.sessionId !== sessionId) return -1;
  if (focusTarget.promptId) {
    return prompts.findIndex((prompt) => prompt.id === focusTarget.promptId);
  }
  if (focusTarget.promptIndex) {
    const idx = focusTarget.promptIndex - 1;
    return idx >= 0 && idx < prompts.length ? idx : -1;
  }
  return -1;
}

function ChipList({ items, mono }: { items: string[]; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className={cn(
            'inline-block max-w-full truncate rounded-sm border border-border bg-muted/30 px-1.5 py-0.5 text-[10px]',
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

function Section({
  title,
  count,
  icon,
  children,
  scrollable,
}: {
  title: string;
  count?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
  scrollable?: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-md border border-border p-2">
      <header className="flex items-center justify-between">
        <MicroLabel className="flex items-center gap-1 text-foreground-passive">
          {icon}
          {title}
        </MicroLabel>
        {typeof count === 'number' ? (
          <span className="font-mono text-[10px] text-foreground-passive">{count}</span>
        ) : null}
      </header>
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1.5',
          scrollable && 'max-h-60 overflow-y-auto pr-0.5'
        )}
      >
        {children}
      </div>
    </section>
  );
}

function ContextItem({
  icon,
  label,
  meta,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  text: string;
}) {
  return (
    <details className="min-w-0 rounded-sm border border-dashed border-border px-2 py-1.5">
      <summary className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-xs">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        {meta ? (
          <span className="shrink-0 font-mono text-[10px] text-foreground-passive">{meta}</span>
        ) : null}
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground-passive">
        {text}
      </pre>
    </details>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-foreground-passive">{children}</p>;
}
