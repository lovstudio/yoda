import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronRight, Info, ListChecks, MessageSquareText, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import {
  SessionInfoPanel,
  SessionPromptsContent,
  SessionPromptsViewAllButton,
  SessionSummaryContent,
  useSessionPrompts,
  useSessionSummary,
} from '../session-info-panel';
import { TaskPanel, TaskTodosCount, useTaskTodos } from '../task-panel';
import { sessionSectionForTab, type SessionPanelSection } from '../types';

/**
 * Merged "Session" sidebar surface — the 百叶窗 (window-blind) accordion that
 * folds the session / conversation / task / naming tabs into one panel. Each
 * blind hosts an existing panel rendered in `chromeless` mode so the blind
 * trigger is the only header. (The agent runtime lives in its own HarnessPanel.)
 */
export const SessionPanel = observer(function SessionPanel() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  // Single-expand 百叶窗: only one blind is open at a time.
  const openSection = taskView.sessionPanelOpenSectionIds[0] ?? '';

  // Deep-link bridge: commands and the context panel still call
  // `setSidebarTab('context' | 'task' | 'hooks' | 'rename')`. Expand the
  // matching blind so those entry points land on the right section — but only
  // on a genuine tab *transition*. Firing on mount (e.g. switching tasks, which
  // remounts this panel with a new `taskView`) would clobber the user's
  // persisted blind choice with the active tab's default section.
  const activeTab = taskView.sidebarTab;
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = activeTab;
    if (prevTab === activeTab) return;
    const section = sessionSectionForTab(activeTab);
    if (section) taskView.setSessionPanelOpenSectionIds([section]);
  }, [activeTab, taskView]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <AccordionPrimitive.Root
        type="single"
        collapsible
        value={openSection}
        onValueChange={(sectionId) =>
          taskView.setSessionPanelOpenSectionIds(sectionId ? [sectionId] : [])
        }
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <Blind
          id="basic"
          icon={<Info className="size-3.5" />}
          title={t('tasks.sessionPanel.basic')}
          open={openSection === 'basic'}
        >
          {(active) => <SessionInfoPanel active={active} chromeless />}
        </Blind>

        <ConversationBlind
          open={openSection === 'conversation'}
          title={t('tasks.sessionPanel.conversation')}
        />

        <TasksBlind open={openSection === 'tasks'} title={t('tasks.sessionPanel.tasks')} />

        <SummaryBlind open={openSection === 'summary'} title={t('tasks.sessionPanel.summary')} />
      </AccordionPrimitive.Root>
    </div>
  );
});

function Blind({
  id,
  icon,
  title,
  open,
  actions,
  children,
}: {
  id: SessionPanelSection;
  icon: React.ReactNode;
  title: string;
  open: boolean;
  /** Toolbar actions rendered on the right of the header while the blind is open. */
  actions?: React.ReactNode;
  children: (active: boolean) => React.ReactNode;
}) {
  return (
    <AccordionPrimitive.Item value={id} className="min-w-0 border-b border-border/70">
      <AccordionPrimitive.Header className="m-0 flex h-8 min-w-0 items-center pr-1.5 hover:bg-background-2">
        <AccordionPrimitive.Trigger className="group flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border">
          <ChevronRight className="size-3 shrink-0 text-foreground-passive transition-transform group-data-[state=open]:rotate-90" />
          <span className="shrink-0 text-foreground-passive">{icon}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={title}>
            {title}
          </span>
        </AccordionPrimitive.Trigger>
        {open && actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="overflow-hidden border-t border-border/50 bg-background-1/20">
        {/* Only mount panel work (queries, live refresh) while the blind is open. */}
        {open ? children(true) : null}
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

/**
 * The 对话 blind: loads prompt history once and feeds both the header's
 * view-all action and the content preview.
 */
const ConversationBlind = observer(function ConversationBlind({
  open,
  title,
}: {
  open: boolean;
  title: string;
}) {
  const prompts = useSessionPrompts(open);
  return (
    <Blind
      id="conversation"
      icon={<MessageSquareText className="size-3.5" />}
      title={title}
      open={open}
      actions={<SessionPromptsViewAllButton prompts={prompts} />}
    >
      {() => <SessionPromptsContent prompts={prompts} />}
    </Blind>
  );
});

/**
 * The 任务 blind: loads todo state once and feeds both the header's progress
 * count and the panel content.
 */
const TasksBlind = observer(function TasksBlind({ open, title }: { open: boolean; title: string }) {
  const todos = useTaskTodos();
  return (
    <Blind
      id="tasks"
      icon={<ListChecks className="size-3.5" />}
      title={title}
      open={open}
      actions={<TaskTodosCount todos={todos} />}
    >
      {() => <TaskPanel chromeless todos={todos} />}
    </Blind>
  );
});

/**
 * The 摘要 blind: surfaces the latest compaction summary the agent runtime
 * itself wrote into the transcript (Claude Code's `isCompactSummary` row /
 * Codex's SUMMARY_PREFIX message). Nothing is generated locally.
 */
const SummaryBlind = observer(function SummaryBlind({
  open,
  title,
}: {
  open: boolean;
  title: string;
}) {
  const summary = useSessionSummary(open);
  return (
    <Blind id="summary" icon={<Sparkles className="size-3.5" />} title={title} open={open}>
      {() => <SessionSummaryContent summary={summary} />}
    </Blind>
  );
});
