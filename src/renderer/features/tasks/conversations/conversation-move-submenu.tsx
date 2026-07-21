import { MoveRight, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import { moveConversationToTask } from './move-conversation-to-task';

const SEARCH_THRESHOLD = 8;

export type ConversationMoveTarget = {
  id: string;
  name: string;
};

export function conversationMoveTargets(
  tasks: Iterable<TaskStore>,
  currentTaskId: string
): ConversationMoveTarget[] {
  const targets: ConversationMoveTarget[] = [];
  for (const store of tasks) {
    const task = registeredTaskData(store);
    if (
      !task ||
      task.id === currentTaskId ||
      task.archivedAt !== undefined ||
      task.archiveRequestedAt !== undefined
    ) {
      continue;
    }
    targets.push({ id: task.id, name: task.name });
  }
  return targets;
}

function TaskSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-1 pt-1 pb-0.5">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-foreground-muted" />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('tasks.conversations.moveToTaskSearch')}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) return;
            event.stopPropagation();
          }}
          className="h-7 w-full rounded-sm bg-background-2 pr-2 pl-7 text-sm outline-none placeholder:text-foreground-muted"
        />
      </div>
    </div>
  );
}

export const ConversationMoveSubmenu = observer(function ConversationMoveSubmenu({
  projectId,
  taskId,
  conversationId,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
}) {
  const { t } = useTranslation();
  const manager = getTaskManagerStore(projectId);
  const targets = manager ? conversationMoveTargets(manager.tasks.values(), taskId) : [];
  const [query, setQuery] = useState('');
  const filteredTargets = (() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return targets;
    return targets.filter((target) => target.name.toLowerCase().includes(normalizedQuery));
  })();
  const showSearch = targets.length >= SEARCH_THRESHOLD;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="whitespace-nowrap">
        <MoveRight className="size-4" />
        {t('tasks.conversations.moveToTaskMenu')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        {showSearch ? <TaskSearchField value={query} onChange={setQuery} /> : null}
        <div className="max-h-72 overflow-y-auto">
          {filteredTargets.length === 0 ? (
            <ContextMenuItem disabled>{t('tasks.conversations.moveToTaskEmpty')}</ContextMenuItem>
          ) : (
            filteredTargets.map((target) => (
              <ContextMenuItem
                key={target.id}
                className="whitespace-nowrap"
                onClick={() =>
                  void moveConversationToTask({
                    projectId,
                    sourceTaskId: taskId,
                    targetTaskId: target.id,
                    targetTaskName: target.name,
                    conversationId,
                  })
                }
              >
                {target.name}
              </ContextMenuItem>
            ))
          )}
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
});
