import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tabDragSource } from '@renderer/app/tab-drag';
import { cn } from '@renderer/utils/utils';

export function ConversationDragHandle({
  projectId,
  taskId,
  conversationId,
  className,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t('tasks.conversations.moveToTask');

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-foreground-passive outline-none hover:bg-background-2 hover:text-foreground active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      {...tabDragSource(() => ({
        kind: 'conversation-transfer',
        projectId,
        sourceTaskId: taskId,
        conversationId,
      }))}
    >
      <GripVertical className="size-3.5" aria-hidden />
    </button>
  );
}
