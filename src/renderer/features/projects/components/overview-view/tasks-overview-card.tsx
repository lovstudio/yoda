import { ArrowRight, ListTodo } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { ReadyTask } from '@renderer/features/projects/components/task-view/task-row';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';

const RECENT_LIMIT = 5;

export const TasksOverviewCard = observer(function TasksOverviewCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const project = asMounted(getProjectStore(projectId));
  const taskManager = getTaskManagerStore(projectId);

  const allTasks: ReadyTask[] = taskManager
    ? Array.from(taskManager.tasks.values()).filter(
        (t): t is ReadyTask => t.state !== 'unregistered'
      )
    : [];
  const active = allTasks.filter((t) => !t.data.archivedAt);
  const archived = allTasks.filter((t) => Boolean(t.data.archivedAt));
  const recent = active
    .slice()
    .sort((a, b) => {
      const lhs = a.data.lastInteractedAt ? Date.parse(a.data.lastInteractedAt) : 0;
      const rhs = b.data.lastInteractedAt ? Date.parse(b.data.lastInteractedAt) : 0;
      return rhs - lhs;
    })
    .slice(0, RECENT_LIMIT);

  const goToTasks = () => {
    if (project) project.view.setProjectView('tasks' as ProjectView);
  };

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground inline-flex items-center gap-2">
            <ListTodo className="size-3.5" />
            {t('tasks.task')}
          </h2>
          <span className="text-xs text-foreground-muted">
            {t('projects.taskCounts', { active: active.length, archived: archived.length })}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={goToTasks}>
          {t('projects.viewAll')}
          <ArrowRight className="size-3.5" />
        </Button>
      </header>
      {recent.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('projects.noActiveTasks')}</p>
      ) : (
        <ul className="space-y-1">
          {recent.map((task) => (
            <li key={task.data.id}>
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-background-hover transition-colors"
                onClick={() => navigate('task', { projectId, taskId: task.data.id })}
              >
                <span className="truncate font-medium text-foreground">{task.data.name}</span>
                <span className="text-foreground-muted shrink-0">
                  {task.data.lastInteractedAt && (
                    <RelativeTime value={task.data.lastInteractedAt} compact />
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
