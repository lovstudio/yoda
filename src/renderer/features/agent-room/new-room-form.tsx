import { Check } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/agents';
import {
  DEFAULT_ROUTING_HOP_LIMIT,
  normalizeRoutingHopLimit,
  type RoutingHopLimit,
} from '@shared/team-routing-limit';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { agentRoomStore } from './agent-room-store';

const RUNTIME_OPTIONS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

type ProjectOpt = { id: string; name: string; baseRef: string | null };
type Mode = 'review' | 'freeform';
type TaskMode = 'existing' | 'new';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'room';

export const NewRoomForm = observer(function NewRoomForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [mode, setMode] = useState<Mode>('review');
  const [projectId, setProjectId] = useState('');
  const [taskMode, setTaskMode] = useState<TaskMode>('existing');
  const [taskId, setTaskId] = useState('');
  const [newTaskName, setNewTaskName] = useState('');
  const [name, setName] = useState('');
  const [requirement, setRequirement] = useState('');
  const [implementerRuntime, setImplementerRuntime] = useState('claude');
  const [reviewerRuntime, setReviewerRuntime] = useState('codex');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [routingHopLimit, setRoutingHopLimit] =
    useState<RoutingHopLimit>(DEFAULT_ROUTING_HOP_LIMIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rpc.projects.getProjects().then((rows) => {
      setProjects(
        rows.map((p) => ({
          id: p.id,
          name: p.name,
          baseRef: 'baseRef' in p ? p.baseRef : null,
        }))
      );
    });
    void rpc.agentsConfig.list().then(setAgents);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    void rpc.tasks.getTasks(projectId).then((rows) => {
      setTasks(rows.map((tk) => ({ id: tk.id, name: tk.name })));
    });
  }, [projectId]);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const canUseNewTask = Boolean(project?.baseRef);

  const taskReady = taskMode === 'existing' ? Boolean(taskId) : Boolean(newTaskName.trim());
  const modeReady = mode === 'review' ? Boolean(requirement.trim()) : selectedAgentIds.length > 0;
  const canCreate = Boolean(projectId && taskReady && name.trim() && modeReady && !busy);

  const resolveTaskId = async (): Promise<string> => {
    if (taskMode === 'existing') return taskId;
    if (!project?.baseRef) throw new Error(t('agentRoom.errors.localOnly'));
    const id = crypto.randomUUID();
    const branch = `agent-room/${slug(newTaskName)}-${id.slice(0, 6)}`;
    const res = await rpc.tasks.createTask({
      id,
      projectId,
      name: newTaskName.trim(),
      sourceBranch: { type: 'local', branch: project.baseRef },
      strategy: { kind: 'new-branch', taskBranch: branch, pushBranch: false },
    });
    // createTask resolves only after the worktree is set up AND provisioned, so
    // no polling is needed — but a branch-setup failure comes back as success
    // with a non-'ready' setupStatus, which must NOT seed a room on a dead task.
    if (!res.success) throw new Error(t('agentRoom.errors.taskCreate'));
    if (res.data.task.setupStatus !== 'ready') {
      throw new Error(res.data.task.setupError || t('agentRoom.errors.taskSetup'));
    }
    return res.data.task.id;
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const resolvedTaskId = await resolveTaskId();
      if (mode === 'review') {
        await agentRoomStore.createReviewRoom({
          projectId,
          taskId: resolvedTaskId,
          name: name.trim(),
          requirement: requirement.trim(),
          implementerRuntime,
          reviewerRuntime,
          routingHopLimit,
        });
      } else {
        const members = selectedAgentIds
          .map((id) => agents.find((a) => a.id === id))
          .filter((a): a is Agent => Boolean(a))
          .map((a) => ({
            handle: a.slug,
            displayName: a.name,
            icon: a.icon,
            runtime: a.preferredRuntime ?? 'claude',
            systemPrompt: a.systemPrompt,
          }));
        await agentRoomStore.createFreeformRoom({
          projectId,
          taskId: resolvedTaskId,
          name: name.trim(),
          members,
          routingHopLimit,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t('agentRoom.newRoom')}</h2>

        {/* mode toggle */}
        <div className="mb-4 inline-flex rounded-lg border border-border bg-background-1 p-0.5">
          {(['review', 'freeform'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {t(`agentRoom.mode.${m}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Field label={t('agentRoom.field.project')}>
            <Select
              value={projectId}
              onChange={setProjectId}
              placeholder={t('agentRoom.selectProject')}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          {/* task: existing or new worktree */}
          <Field label={t('agentRoom.field.task')}>
            <div className="mb-2 inline-flex gap-1 text-xs">
              {(['existing', 'new'] as const).map((tm) => (
                <button
                  key={tm}
                  type="button"
                  disabled={tm === 'new' && !canUseNewTask}
                  onClick={() => setTaskMode(tm)}
                  className={cn(
                    'rounded-md border px-2 py-1 transition-colors disabled:opacity-40',
                    taskMode === tm
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-foreground-muted hover:text-foreground'
                  )}
                >
                  {t(`agentRoom.${tm === 'existing' ? 'taskExisting' : 'taskNew'}`)}
                </button>
              ))}
            </div>
            {taskMode === 'existing' ? (
              <Select
                value={taskId}
                onChange={setTaskId}
                placeholder={t('agentRoom.selectTask')}
                disabled={!projectId}
              >
                {tasks.map((tk) => (
                  <option key={tk.id} value={tk.id}>
                    {tk.name}
                  </option>
                ))}
              </Select>
            ) : (
              <input
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                placeholder={t('agentRoom.field.taskName')}
                className="w-full rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
            )}
          </Field>

          <Field label={t('agentRoom.field.roomName')}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('agentRoom.field.roomNamePlaceholder')}
              className="w-full rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
          </Field>

          <Field label={t('agentRoom.field.routingHopLimit')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                disabled={routingHopLimit === null}
                value={routingHopLimit ?? ''}
                onChange={(e) =>
                  setRoutingHopLimit(normalizeRoutingHopLimit(Number(e.target.value)))
                }
                className="min-w-0 flex-1 rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60 disabled:opacity-50"
              />
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-muted">
                <input
                  type="checkbox"
                  checked={routingHopLimit === null}
                  onChange={(e) =>
                    setRoutingHopLimit(e.target.checked ? null : DEFAULT_ROUTING_HOP_LIMIT)
                  }
                />
                {t('agentRoom.field.routingHopLimitInfinite')}
              </span>
            </div>
            <span className="text-[11px] text-foreground-passive">
              {t('agentRoom.field.routingHopLimitHint')}
            </span>
          </Field>

          {mode === 'review' ? (
            <>
              <Field label={t('agentRoom.field.requirement')}>
                <textarea
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  rows={3}
                  placeholder={t('agentRoom.field.requirementPlaceholder')}
                  className="w-full resize-none rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('agentRoom.field.implementer')}>
                  <Select value={implementerRuntime} onChange={setImplementerRuntime}>
                    {RUNTIME_OPTIONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('agentRoom.field.reviewer')}>
                  <Select value={reviewerRuntime} onChange={setReviewerRuntime}>
                    {RUNTIME_OPTIONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          ) : (
            <Field label={t('agentRoom.field.members')}>
              {agents.length === 0 ? (
                <p className="text-xs text-foreground-muted">{t('agentRoom.noAgents')}</p>
              ) : (
                <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-background-1 p-1.5">
                  {agents.map((a) => {
                    const on = selectedAgentIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          setSelectedAgentIds((ids) =>
                            on ? ids.filter((x) => x !== a.id) : [...ids, a.id]
                          )
                        }
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          on ? 'bg-primary/10 text-foreground' : 'hover:bg-background-2'
                        )}
                      >
                        <AvatarValue
                          name={a.name}
                          value={a.icon}
                          className="size-6 rounded-md text-xs"
                        />
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        {on && <Check className="size-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background-1 px-3 py-2 text-sm transition-colors hover:bg-background-2"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!canCreate}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? t('agentRoom.creating') : t('agentRoom.createStart')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60 disabled:opacity-50"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}
