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
    <section className="flex min-w-0 flex-1 flex-col">
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
        <div className="ml-auto flex items-center gap-3">
          {agents.map((m) => (
            <div
              key={m.id}
              className="relative"
              title={`${m.displayName} · ${STATUS_LABEL[m.status]}`}
            >
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
          ))}
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

function TeamIntroCard({
  agents,
  preset,
}: {
  agents: RoomMember[];
  preset: RoomSnapshot['room']['preset'];
}) {
  const { t } = useTranslation();
  const desc =
    preset === 'review-loop' ? t('agentRoom.intro.review') : t('agentRoom.intro.freeform');
  return (
    <div className="mb-4 rounded-xl border border-border bg-background-1 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <span className="text-sm font-semibold">{t('agentRoom.intro.title')}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-foreground-muted">{desc}</p>
      <div className="flex flex-col gap-1.5">
        {agents.map((m) => (
          <div key={m.id} className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                ACCENT_AVATAR[m.accent]
              )}
            >
              {monogram(m.displayName)}
            </div>
            <span className="text-sm font-medium">{m.displayName}</span>
            <span className="text-xs text-foreground-muted">{m.role}</span>
            <span className="ml-auto font-mono text-[10px] text-foreground-muted">@{m.handle}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  if (message.kind === 'system') {
    return (
      <div className="my-2 text-center text-xs italic text-foreground-muted">{message.body}</div>
    );
  }
  const author = message.authorMemberId ? byId.get(message.authorMemberId) : undefined;
  const accent = author?.accent ?? 'terra';
  const name = author?.displayName ?? 'You';
  const isInspected = message.sessionRef === inspectedId && inspectedId !== null;

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
              {t('agentRoom.handoff')}
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {renderBody(message.body, byHandle)}
        </div>
        {message.sessionRef && (
          <button
            type="button"
            onClick={() => agentRoomStore.setInspectedConversation(message.sessionRef)}
            className={cn(
              'mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              isInspected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background-1 text-foreground-muted hover:border-primary hover:text-foreground'
            )}
          >
            <TerminalSquare className="size-3" />
            {isInspected ? t('agentRoom.hideSession') : t('agentRoom.openSession')}
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
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const query = value.match(/@([a-z0-9_-]*)$/i)?.[1]?.toLowerCase() ?? null;
  const mentionable = [
    { handle: 'all', displayName: 'Everyone', accent: 'slate' as const },
    ...members
      .filter((m) => m.role !== 'lead')
      .map((m) => ({ handle: m.handle, displayName: m.displayName, accent: m.accent })),
  ];
  const suggestions =
    query !== null ? mentionable.filter((s) => s.handle.toLowerCase().startsWith(query)) : [];

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
              key={m.handle}
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
          placeholder={t('agentRoom.composerPlaceholder')}
          onChange={(e) => {
            setValue(e.target.value);
            setSuggestOpen(/@([a-z0-9_-]*)$/i.test(e.target.value));
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
