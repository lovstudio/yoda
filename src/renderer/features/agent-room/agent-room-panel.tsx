import { MessagesSquare, Plus, Send, Sparkles, TerminalSquare, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomMember, RoomMessage, RoomSnapshot } from '@shared/team-room';
import { cn } from '@renderer/utils/utils';
import { ACCENT_AVATAR, ACCENT_MENTION, ACCENT_TEXT, STATUS_DOT, STATUS_LABEL } from './accent';
import { agentRoomStore } from './agent-room-store';
import { NewRoomForm } from './new-room-form';
import { RoomSessionInspector } from './room-session-inspector';

const monogram = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

export const AgentRoomMainPanel = observer(function AgentRoomMainPanel() {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void agentRoomStore.loadRooms();
    return () => agentRoomStore.dispose();
  }, []);

  const { rooms, snapshot, activeRoomId } = agentRoomStore;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background-secondary">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('agentRoom.rooms')}
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title={t('agentRoom.newRoom')}
            className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {rooms.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-foreground-muted">
              {t('agentRoom.noRooms')}
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
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <MessagesSquare className="size-8 text-foreground-muted/60" />
      <p className="max-w-sm text-sm text-foreground-muted">{t('agentRoom.empty')}</p>
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="size-4" /> {t('agentRoom.newRoom')}
      </button>
    </div>
  );
}

export const RoomChat = observer(function RoomChat({ snapshot }: { snapshot: RoomSnapshot }) {
  const { t } = useTranslation();
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
  const inspectedId = agentRoomStore.inspectedConversationId;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{snapshot.room.name}</h2>
          <p className="text-xs text-foreground-muted">
            {snapshot.room.preset === 'review-loop'
              ? t('agentRoom.preset.review')
              : t('agentRoom.preset.freeform')}{' '}
            · {t('agentRoom.agentCount', { count: agents.length })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {agents.map((m) => {
            const conv = m.conversationId;
            const isInspected = conv !== null && conv === inspectedId;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!conv}
                onClick={() => conv && agentRoomStore.setInspectedConversation(conv)}
                title={
                  conv
                    ? `${m.displayName} · ${STATUS_LABEL[m.status]} — ${t('agentRoom.openSession')}`
                    : `${m.displayName} · ${STATUS_LABEL[m.status]}`
                }
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors',
                  isInspected
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent hover:border-border hover:bg-background-2',
                  !conv && 'cursor-default'
                )}
              >
                <div className="relative">
                  <div
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md text-[11px] font-semibold',
                      ACCENT_AVATAR[m.accent]
                    )}
                  >
                    {monogram(m.displayName)}
                  </div>
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background',
                      STATUS_DOT[m.status]
                    )}
                  />
                </div>
                <span className="text-xs font-medium">{m.displayName}</span>
                {conv && (
                  <TerminalSquare
                    className={cn('size-3', isInspected ? 'text-primary' : 'text-foreground-muted')}
                  />
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <TeamIntroCard agents={agents} preset={snapshot.room.preset} />
            {snapshot.messages.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                byId={byId}
                byHandle={byHandle}
                inspectedId={inspectedId}
              />
            ))}
          </div>
          <Composer members={snapshot.members} />
        </div>

        {inspectedId && (
          <RoomSessionInspector
            projectId={snapshot.room.projectId}
            taskId={snapshot.room.taskId}
            conversationId={inspectedId}
            title={`session · ${inspectedId.slice(0, 8)}`}
            onClose={() => agentRoomStore.setInspectedConversation(null)}
          />
        )}
      </div>
    </section>
  );
});

const TeamIntroCard = observer(function TeamIntroCard({
  agents,
  preset,
}: {
  agents: RoomMember[];
  preset: RoomSnapshot['room']['preset'];
}) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const key = preset === 'review-loop' ? 'review' : 'freeform';
  const impl = agents.find((m) => m.role === 'leader')?.displayName ?? 'Implementer';
  const rev = agents.find((m) => m.role === 'worker')?.displayName ?? 'Reviewer';
  const steps = t(`agentRoom.intro.${key}.steps`, { returnObjects: true, impl, rev }) as string[];

  return (
    <div className="mb-4 rounded-xl border border-border bg-background-1 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <span className="text-sm font-semibold">{t('agentRoom.intro.title')}</span>
      </div>
      <p className="text-xs leading-relaxed text-foreground-muted">
        {t(`agentRoom.intro.${key}.lead`)}
      </p>
      <ol className="my-2 flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground-muted">
            <span className="font-mono text-primary/70">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mb-3 text-[11px] italic text-foreground-muted/80">
        {t(`agentRoom.intro.${key}.note`)}
      </p>
      <div className="flex flex-col gap-0.5">
        {agents.map((m) => {
          const expanded = expandedId === m.id;
          return (
            <div key={m.id} className="rounded-lg">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : m.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-background-2"
              >
                <div
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                    ACCENT_AVATAR[m.accent]
                  )}
                >
                  {monogram(m.displayName)}
                </div>
                <span className="text-sm font-medium">{m.displayName}</span>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-foreground-muted">
                  <span className={cn('size-1.5 rounded-full', STATUS_DOT[m.status])} />
                  {STATUS_LABEL[m.status]}
                </span>
                <span className="font-mono text-[10px] text-foreground-muted">@{m.handle}</span>
              </button>
              {expanded && (
                <div className="mb-1 ml-9 mt-1 flex flex-col gap-1.5 text-xs text-foreground-muted">
                  <div className="flex items-center gap-2">
                    <span>{m.role}</span>
                    {m.runtime && <span className="font-mono opacity-80">{m.runtime}</span>}
                  </div>
                  <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-[11px] leading-relaxed">
                    {m.systemPrompt?.trim() ? m.systemPrompt : t('agentRoom.member.noInstructions')}
                  </div>
                  {m.conversationId && (
                    <button
                      type="button"
                      onClick={() => agentRoomStore.setInspectedConversation(m.conversationId)}
                      className="inline-flex w-fit items-center gap-1 text-[11px] text-foreground-muted transition-colors hover:text-foreground"
                    >
                      <TerminalSquare className="size-3" /> {t('agentRoom.openSession')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function MessageRow({
  message,
  byId,
  byHandle,
  inspectedId,
}: {
  message: RoomMessage;
  byId: Map<string, RoomMember>;
  byHandle: Map<string, RoomMember>;
  inspectedId: string | null;
}) {
  const { t } = useTranslation();
  // System = the referee's voice: a small centered line, with @handles as pills.
  if (message.kind === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <div className="text-center text-xs italic text-foreground-muted">
          {renderBody(message.body, byHandle)}
        </div>
      </div>
    );
  }
  const author = message.authorMemberId ? byId.get(message.authorMemberId) : undefined;
  const accent = author?.accent ?? 'terra';
  const name = author?.displayName ?? 'You';
  const isInspected = message.sessionRef === inspectedId && inspectedId !== null;
  const openSession = message.sessionRef
    ? () => agentRoomStore.setInspectedConversation(message.sessionRef)
    : undefined;

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
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', ACCENT_TEXT[accent])}>{name}</span>
          {message.kind === 'handoff' && (
            <span className="rounded bg-background-2 px-1.5 py-px text-[10px] text-foreground-muted">
              {t('agentRoom.handoff')}
            </span>
          )}
          {openSession && (
            <button
              type="button"
              onClick={openSession}
              className={cn(
                'ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
                isInspected
                  ? 'text-primary'
                  : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
              )}
            >
              <TerminalSquare className="size-3" />
              {isInspected ? t('agentRoom.hideSession') : t('agentRoom.openSession')}
            </button>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {renderBody(message.body, byHandle)}
        </div>
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

type MentionItem = {
  kind: 'mention';
  handle: string;
  displayName: string;
  accent: RoomMember['accent'];
  status: RoomMember['status'] | null;
};
type CommandItem = { kind: 'command'; name: string; label: string; desc: string };
type SuggestItem = MentionItem | CommandItem;

const Composer = observer(function Composer({ members }: { members: RoomMember[] }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const commands: CommandItem[] = useMemo(
    () => [{ kind: 'command', name: 'stop', label: '/stop', desc: t('agentRoom.cmd.stop') }],
    [t]
  );
  const mentionable: MentionItem[] = useMemo(
    () => [
      { kind: 'mention', handle: 'all', displayName: 'Everyone', accent: 'slate', status: null },
      ...members
        .filter((m) => m.role !== 'lead')
        .map(
          (m): MentionItem => ({
            kind: 'mention',
            handle: m.handle,
            displayName: m.displayName,
            accent: m.accent,
            status: m.status,
          })
        ),
    ],
    [members]
  );

  // A leading "/" (no space yet) → command palette; a trailing "@token" → mentions.
  const commandQuery = /^\/[a-z0-9]*$/i.test(value) ? value.slice(1).toLowerCase() : null;
  const mentionQuery =
    commandQuery === null ? (value.match(/@([a-z0-9_-]*)$/i)?.[1]?.toLowerCase() ?? null) : null;
  const suggestions: SuggestItem[] =
    commandQuery !== null
      ? commands.filter((c) => c.name.startsWith(commandQuery))
      : mentionQuery !== null
        ? mentionable.filter((m) => m.handle.toLowerCase().startsWith(mentionQuery))
        : [];

  const isCommand = (name: string) => commands.some((c) => c.name === name);
  const runCommand = (name: string) => {
    if (name === 'stop') void agentRoomStore.stopRoom();
    setValue('');
    setSuggestOpen(false);
  };

  const accept = (item: SuggestItem) => {
    if (item.kind === 'command') {
      runCommand(item.name);
      return;
    }
    setValue((v) => v.replace(/@[a-z0-9_-]*$/i, `@${item.handle} `));
    setSuggestOpen(false);
    taRef.current?.focus();
  };

  const send = () => {
    const body = value.trim();
    if (!body) return;
    if (body.startsWith('/')) {
      const name = body.slice(1).split(/\s+/)[0].toLowerCase();
      if (isCommand(name)) {
        runCommand(name);
        return;
      }
      // Unknown slash text (e.g. a file path) — fall through and post it.
    }
    setValue('');
    setSuggestOpen(false);
    void agentRoomStore.postLeadMessage(body);
  };

  const open = suggestOpen && suggestions.length > 0;

  return (
    <div className="relative border-t border-border px-5 py-3">
      {open && (
        <div className="absolute bottom-full left-5 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-background-2 shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.kind === 'command' ? s.name : s.handle}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                i === sel ? 'bg-background-3' : 'hover:bg-background-3'
              )}
            >
              {s.kind === 'command' ? (
                <>
                  <span className="font-mono text-xs font-semibold text-primary">{s.label}</span>
                  <span className="flex-1 truncate text-[11px] text-foreground-muted">
                    {s.desc}
                  </span>
                </>
              ) : (
                <>
                  <div
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md text-xs font-semibold',
                      ACCENT_AVATAR[s.accent]
                    )}
                  >
                    {monogram(s.displayName)}
                  </div>
                  <span className="flex-1 truncate">{s.displayName}</span>
                  {s.status && (
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <span className={cn('size-1.5 rounded-full', STATUS_DOT[s.status])} />
                      {STATUS_LABEL[s.status]}
                    </span>
                  )}
                  <span className="text-[11px] text-foreground-muted">@{s.handle}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background-1 px-3 py-2 focus-within:border-primary/60">
        <textarea
          ref={taRef}
          value={value}
          rows={1}
          placeholder={t('agentRoom.composerPlaceholder')}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setSuggestOpen(/^\/[a-z0-9]*$/i.test(next) || /@([a-z0-9_-]*)$/i.test(next));
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((x) => (x + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((x) => (x - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                accept(suggestions[sel]);
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
