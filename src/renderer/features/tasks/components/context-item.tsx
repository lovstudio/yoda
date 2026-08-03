import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeMemoryFile, CodexMemoryFile } from '@shared/conversations';
import {
  FileActionsContextMenu,
  FileActionsDropdown,
} from '@renderer/features/tasks/components/file-actions';
import { PersistedDetails } from '@renderer/features/tasks/components/persisted-disclosure';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { useSessionNoteSync } from '@renderer/features/tasks/use-session-note-sync';
import { GlobalFileActionsDropdown } from '@renderer/lib/components/file-path-actions';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';

/**
 * Shared display row for a prompt-context entry (instruction file, memory,
 * tool, …): collapsed label + size, expandable content, and file actions when
 * a source path is known. Used by the session context panel and the composer
 * settings popover — same entity, same surface behavior.
 */
export function ContextItem({
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
  // Outside a task view (e.g. the composer popover) the task-scoped actions
  // (open in editor, reveal in file tree) have no workspace to act on — fall
  // back to the context-free path actions.
  const taskScoped = useProvisionedTask() !== null;
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
          <ContextItemTrailing meta={meta} sourcePath={sourcePath} taskScoped={taskScoped} />
        </summary>
      }
    >
      {text.trim().length === 0 ? (
        <EmptyContextContent sourcePath={sourcePath} />
      ) : renderMode === 'markdown' ? (
        <MarkdownContextContent
          content={text}
          documentPath={sourcePath}
          className="mt-1.5 max-h-56"
        />
      ) : (
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground-passive">
          {text}
        </pre>
      )}
    </PersistedDetails>
  );

  if (!sourcePath || !taskScoped) return item;
  return <FileActionsContextMenu sourcePath={sourcePath}>{item}</FileActionsContextMenu>;
}

function EmptyContextContent({ sourcePath }: { sourcePath?: string }) {
  const { t } = useTranslation();
  return (
    <div className="mt-1.5 rounded-sm border border-dashed border-border/70 bg-background-2/40 px-2 py-2 text-[11px] leading-relaxed text-foreground-passive">
      <div>
        {t(sourcePath ? 'tasks.panel.contextItemEmpty' : 'tasks.panel.contextItemNoSource')}
      </div>
      {sourcePath ? (
        <div className="mt-1 truncate font-mono text-[10px]" title={sourcePath}>
          {sourcePath}
        </div>
      ) : null}
    </div>
  );
}

export function MarkdownContextContent({
  content,
  documentPath,
  className,
}: {
  content: string;
  documentPath?: string;
  className?: string;
}) {
  // Opened from a session's context → enable annotations and sync notes into
  // that session's input box. Off in non-session surfaces (composer popover).
  const syncNote = useSessionNoteSync();
  return (
    <MarkdownRenderer
      content={content}
      variant="compact"
      annotations={syncNote !== undefined}
      onAddNote={syncNote}
      documentPath={documentPath}
      className={cn(
        'overflow-auto break-words text-[11px] leading-relaxed text-foreground-passive [&>*:last-child]:mb-0 [&_pre]:max-w-full',
        className
      )}
    />
  );
}

function ContextItemTrailing({
  meta,
  sourcePath,
  taskScoped,
}: {
  meta?: string;
  sourcePath?: string;
  taskScoped: boolean;
}) {
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
        {taskScoped ? (
          <FileActionsDropdown sourcePath={sourcePath} />
        ) : (
          <GlobalFileActionsDropdown absolutePath={sourcePath} />
        )}
      </span>
    </span>
  );
}

export function memoryFileLabel(
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
