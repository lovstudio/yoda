import { CornerUpRight, MessagesSquare, Plus, Send, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomMember, RoomMessage, RoomSnapshot } from '@shared/team-room';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { ACCENT_AVATAR, ACCENT_MENTION, ACCENT_TEXT, STATUS_DOT, STATUS_LABEL } from './accent';
import { agentRoomStore } from './agent-room-store';

const monogram = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

export const AgentRoomMainPanel = observer(function AgentRoomMainPanel() {
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void agentRoomStore.loadRooms();
    return () => agentRoomStore.dispose();
  }, []);

  const { rooms, snapshot, activeRoomId } = agentRoomStore;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* room list */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background-secondary">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Rooms
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="New Agent Room"
            className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {rooms.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-foreground-muted">
              No rooms yet. Create one to gather a few agents into a chat.
            </p>
          ) : (
            rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  void agentRoomStore.selectRoom(room.id);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                  room.id === activeRoomId && !creating
                    ? 'bg-background-2 text-foreground'
                    : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
                )}
              >
                <MessagesSquare className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{room.name}</span>
                {room.preset === 'review-loop' && (
                  <Sparkles className="size-3 shrink-0 text-primary/70" />
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* main area */}
      {creating ? (
        <NewRoomForm onClose={() => setCreating(false)} />
      ) : snapshot && snapshot.room.id === activeRoomId ? (
        <RoomChat snapshot={snapshot} />
      ) : (
        <EmptyState onCreate={() => setCreating(true)} />
      )}
    </div>
  );
});

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <MessagesSquare className="size-8 text-foreground-muted/60" />
      <p className="max-w-sm text-sm text-foreground-muted">
        An Agent Room is a group chat where each teammate is an agent. @mention one to assign it a
        task — it spins up its own session and reports back.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="size-4" /> New Agent Room
      </button>
    </div>
  );
}

const RoomChat = observer(function RoomChat({ snapshot }: { snapshot: RoomSnapshot }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m])), [snapshot.members]);
  const byHandle = useMemo(
    () => new Map(snapshot.members.map((m) => [m.handle.toLowerCase(), m])),
    [snapshot.members]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [snapshot.messages.length]);

  const agents = snapshot.members.filter((m) => m.role !== 'lead');

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* header + roster */}
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{snapshot.room.name}</h2>
          <p className="text-xs text-foreground-muted">
            {snapshot.room.preset === 'review-loop' ? 'Review loop' : 'Freeform'} · {agents.length}{' '}
            agent{agents.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {agents.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-1.5"
              title={`${m.displayName} · ${STATUS_LABEL[m.status]}`}
            >
              <div className="relative">
                <div
                  className={cn(
                    'flex size-7 items-center justify-center rounded-lg text-xs font-semibold',
                    ACCENT_AVATAR[m.accent]
                  )}
                >
                  {monogram(m.displayName)}
                </div>
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background',
                    STATUS_DOT[m.status]
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </header>

      {/* timeline */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {snapshot.messages.map((msg) => (
          <MessageRow key={msg.id} message={msg} byId={byId} byHandle={byHandle} room={snapshot} />
        ))}
      </div>

      <Composer members={snapshot.members} />
    </section>
  );
});

function MessageRow({
  message,
  byId,
  byHandle,
  room,
}: {
  message: RoomMessage;
  byId: Map<string, RoomMember>;
  byHandle: Map<string, RoomMember>;
  room: RoomSnapshot;
}) {
  const { navigate } = useNavigate();
  if (message.kind === 'system') {
    return (
      <div className="my-2 text-center text-xs italic text-foreground-muted">{message.body}</div>
    );
  }
  const author = message.authorMemberId ? byId.get(message.authorMemberId) : undefined;
  const accent = author?.accent ?? 'terra';
  const name = author?.displayName ?? 'You';

  return (
    <div className="flex gap-3 py-2.5">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
          ACCENT_AVATAR[accent]
        )}
      >
        {monogram(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('text-sm font-semibold', ACCENT_TEXT[accent])}>{name}</span>
          {author && <span className="text-[11px] text-foreground-muted">{author.role}</span>}
          {message.kind === 'handoff' && (
            <span className="rounded bg-background-2 px-1.5 py-px text-[10px] text-foreground-muted">
              hand-off
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {renderBody(message.body, byHandle)}
        </div>
        {message.sessionRef && (
          <button
            type="button"
            onClick={() =>
              navigate('task', {
                projectId: room.room.projectId,
                taskId: room.room.taskId,
                tab: { kind: 'conversation', conversationId: message.sessionRef as string },
              })
            }
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background-1 px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-primary hover:text-foreground"
          >
            <CornerUpRight className="size-3" /> open session
          </button>
        )}
      </div>
    </div>
  );
}

/** Render @handles as colored pills; preserve the rest as text. */
function renderBody(body: string, byHandle: Map<string, RoomMember>) {
  const parts = body.split(/(@[a-z0-9_-]+)/gi);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const member = byHandle.get(part.slice(1).toLowerCase());
      if (member) {
        return (
          <span
            key={i}
            className={cn(
              'rounded px-1 py-px text-[13px] font-medium',
              ACCENT_MENTION[member.accent]
            )}
          >
            @{member.displayName}
          </span>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

const Composer = observer(function Composer({ members }: { members: RoomMember[] }) {
  const [value, setValue] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const query = value.match(/@([a-z0-9_-]*)$/i)?.[1]?.toLowerCase() ?? null;
  const suggestions =
    query !== null
      ? members.filter((m) => m.role !== 'lead' && m.handle.toLowerCase().startsWith(query))
      : [];

  const pick = (handle: string) => {
    setValue((v) => v.replace(/@[a-z0-9_-]*$/i, `@${handle} `));
    setSuggestOpen(false);
    taRef.current?.focus();
  };

  const send = () => {
    const body = value.trim();
    if (!body) return;
    setValue('');
    setSuggestOpen(false);
    void agentRoomStore.postLeadMessage(body);
  };

  return (
    <div className="relative border-t border-border px-5 py-3">
      {suggestOpen && suggestions.length > 0 && (
        <div className="absolute bottom-full left-5 mb-2 w-64 overflow-hidden rounded-lg border border-border bg-background-2 shadow-lg">
          {suggestions.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m.handle);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                i === sel ? 'bg-background-3' : 'hover:bg-background-3'
              )}
            >
              <div
                className={cn(
                  'flex size-6 items-center justify-center rounded-md text-xs font-semibold',
                  ACCENT_AVATAR[m.accent]
                )}
              >
                {monogram(m.displayName)}
              </div>
              <span className="flex-1">{m.displayName}</span>
              <span className="text-[11px] text-foreground-muted">@{m.handle}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background-1 px-3 py-2 focus-within:border-primary/60">
        <textarea
          ref={taRef}
          value={value}
          rows={1}
          placeholder="Message the room — @mention a teammate to assign a task…"
          onChange={(e) => {
            setValue(e.target.value);
            const q = e.target.value.match(/@([a-z0-9_-]*)$/i);
            setSuggestOpen(Boolean(q));
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (suggestOpen && suggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => (s + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => (s - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(suggestions[sel].handle);
                return;
              }
              if (e.key === 'Escape') {
                setSuggestOpen(false);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
        />
        <button
          type="button"
          onClick={send}
          disabled={!value.trim()}
          className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
});

const RUNTIME_OPTIONS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

const NewRoomForm = observer(function NewRoomForm({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [name, setName] = useState('');
  const [requirement, setRequirement] = useState('');
  const [implementerRuntime, setImplementerRuntime] = useState('claude');
  const [reviewerRuntime, setReviewerRuntime] = useState('codex');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void rpc.projects.getProjects().then((rows) => {
      setProjects(rows.map((p) => ({ id: p.id, name: p.name })));
    });
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

  const canCreate = projectId && taskId && name.trim() && requirement.trim() && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      await agentRoomStore.createReviewRoom({
        projectId,
        taskId,
        name: name.trim(),
        requirement: requirement.trim(),
        implementerRuntime,
        reviewerRuntime,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-md">
        <h2 className="mb-1 text-lg font-semibold">New Agent Room</h2>
        <p className="mb-5 text-sm text-foreground-muted">
          Review-loop preset: an implementer and a reviewer collaborate in an existing task's
          worktree until the reviewer signs off.
        </p>
        <div className="flex flex-col gap-3">
          <Field label="Project">
            <Select value={projectId} onChange={setProjectId} placeholder="Select a project">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Task (worktree)">
            <Select
              value={taskId}
              onChange={setTaskId}
              placeholder="Select a task"
              disabled={!projectId}
            >
              {tasks.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {tk.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Auth refactor review"
              className="w-full rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
          </Field>
          <Field label="Requirement (the lead's opening ask)">
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              rows={3}
              placeholder="What should the implementer build / fix?"
              className="w-full resize-none rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Implementer">
              <Select value={implementerRuntime} onChange={setImplementerRuntime}>
                {RUNTIME_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reviewer">
              <Select value={reviewerRuntime} onChange={setReviewerRuntime}>
                {RUNTIME_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background-1 px-3 py-2 text-sm transition-colors hover:bg-background-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!canCreate}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create & start'}
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
