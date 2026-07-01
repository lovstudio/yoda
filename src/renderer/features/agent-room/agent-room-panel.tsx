import { Send, Settings, TerminalSquare, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomMember, RoomMessage, RoomSnapshot } from '@shared/team-room';
import {
  DEFAULT_ROUTING_HOP_LIMIT,
  normalizeRoutingHopLimit,
  type RoutingHopLimit,
} from '@shared/team-routing-limit';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import {
  ACCENT_AVATAR,
  ACCENT_MENTION,
  ACCENT_TEXT,
  STATUS_DOT,
  STATUS_LABEL,
  STATUS_TEXT,
} from './accent';
import { agentRoomStore } from './agent-room-store';

const monogram = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
const avatarText = (displayName: string, icon?: string) => icon?.trim() || monogram(displayName);

/** Opens an agent's detail / a session as a normal task tab (defaulting to the sidebar). */
type OpenTab = (id: string) => void;

/**
 * The team-room group chat — rendered as a task's Overview surface. The ONLY
 * room-specific UI; everything else (agent details, sessions) opens as a normal
 * task tab via the task's own TabManagerStore, so they behave like any other tab.
 */
export const RoomChat = observer(function RoomChat({ snapshot }: { snapshot: RoomSnapshot }) {
  const { t } = useTranslation();
  const { taskView, conversations } = useProvisionedTask();
  const { tabManager } = taskView;
  const scrollRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m])), [snapshot.members]);
  const byHandle = useMemo(
    () => new Map(snapshot.members.map((m) => [m.handle.toLowerCase(), m])),
    [snapshot.members]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [snapshot.messages.length]);

  // Agent → its room-member detail tab; session → its conversation tab. Both
  // default to the sidebar so the chat stays put alongside the opened tab;
  // reveal the sidebar in case it was collapsed.
  const openMember: OpenTab = (memberId) => {
    tabManager.openRoomMemberInSidebar(memberId);
    taskView.setSidebarCollapsed(false);
  };
  const openSession: OpenTab = (conversationId) => {
    void (async () => {
      // The session was created in the main process and may not be in the
      // renderer store yet — there is no `conversation:created` bridge. Load it
      // first, or the tab resolves to no store and the pane is blank.
      const loaded = await conversations.ensureConversation(conversationId);
      if (!loaded) return;
      tabManager.openConversationInSidebar(conversationId);
      taskView.setSidebarCollapsed(false);
    })();
  };

  const agents = snapshot.members.filter((m) => m.role !== 'lead');

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{snapshot.room.name}</h2>
          <p className="text-xs text-foreground-muted">
            {snapshot.room.preset === 'review-loop'
              ? t('agentRoom.preset.review')
              : t('agentRoom.preset.freeform')}{' '}
            · {t('agentRoom.agentCount', { count: agents.length })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <RoomSettingsPopover room={snapshot.room} />
          <TeamIntroPopover
            agents={agents}
            preset={snapshot.room.preset}
            updatedAt={snapshot.room.updatedAt}
            onOpenMember={openMember}
          />
          <div className="flex items-center gap-1.5">
            {agents.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => openMember(m.id)}
                title={t('agentRoom.viewAgent')}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1 transition-colors hover:border-border hover:bg-background-2"
              >
                <div className="relative">
                  <div
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md text-[11px] font-semibold',
                      ACCENT_AVATAR[m.accent]
                    )}
                  >
                    {avatarText(m.displayName, m.icon)}
                  </div>
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background',
                      STATUS_DOT[m.status]
                    )}
                  />
                </div>
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-xs font-medium">{m.displayName}</span>
                  <span className={cn('text-[10px]', STATUS_TEXT[m.status])}>
                    {STATUS_LABEL[m.status]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {snapshot.messages.map((msg) => (
          <MessageRow
            key={msg.id}
            message={msg}
            byId={byId}
            byHandle={byHandle}
            onOpenMember={openMember}
            onOpenSession={openSession}
          />
        ))}
      </div>
      <Composer members={snapshot.members} />
    </section>
  );
});

const RoomSettingsPopover = observer(function RoomSettingsPopover({
  room,
}: {
  room: RoomSnapshot['room'];
}) {
  const { t } = useTranslation();
  const [routingHopLimit, setRoutingHopLimit] = useState<RoutingHopLimit>(room.routingHopLimit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRoutingHopLimit(room.routingHopLimit);
  }, [room.id, room.routingHopLimit]);

  const dirty = routingHopLimit !== room.routingHopLimit;
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await agentRoomStore.updateRoomConfig({ roomId: room.id, routingHopLimit });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('agentRoom.settings.title')}
        title={t('agentRoom.settings.title')}
        className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
      >
        <Settings className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 gap-3 border border-border bg-background p-3 text-foreground shadow-lg"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-primary" />
            <div className="min-w-0 flex-1 text-sm font-semibold">
              {t('agentRoom.settings.title')}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground-muted">
              {t('agentRoom.field.routingHopLimit')}
            </span>
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
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
});

const TeamIntroPopover = observer(function TeamIntroPopover({
  agents,
  preset,
  updatedAt,
  onOpenMember,
}: {
  agents: RoomMember[];
  preset: RoomSnapshot['room']['preset'];
  updatedAt: string;
  onOpenMember: OpenTab;
}) {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('agentRoom.intro.title')}
        title={t('agentRoom.intro.title')}
        className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
      >
        <Users className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 gap-3 border border-border bg-background p-3 text-foreground shadow-lg"
      >
        <TeamIntroPanel
          agents={agents}
          preset={preset}
          updatedAt={updatedAt}
          onOpenMember={onOpenMember}
        />
      </PopoverContent>
    </Popover>
  );
});

const TeamIntroPanel = observer(function TeamIntroPanel({
  agents,
  preset,
  updatedAt,
  onOpenMember,
}: {
  agents: RoomMember[];
  preset: RoomSnapshot['room']['preset'];
  updatedAt: string;
  onOpenMember: OpenTab;
}) {
  const { t } = useTranslation();
  const key = preset === 'review-loop' ? 'review' : 'freeform';
  const impl = agents.find((m) => m.role === 'leader')?.displayName ?? 'Implementer';
  const rev = agents.find((m) => m.role === 'worker')?.displayName ?? 'Reviewer';
  const steps = t(`agentRoom.intro.${key}.steps`, { returnObjects: true, impl, rev }) as string[];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <span className="min-w-0 flex-1 text-sm font-semibold">{t('agentRoom.intro.title')}</span>
        <RelativeTime
          value={updatedAt}
          compact
          ago
          className="shrink-0 text-[11px] text-foreground-passive"
        />
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
      <p className="text-[11px] italic text-foreground-muted/80">
        {t(`agentRoom.intro.${key}.note`)}
      </p>
      <div className="flex flex-col gap-0.5">
        {agents.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOpenMember(m.id)}
            title={t('agentRoom.viewAgent')}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1 text-left transition-colors hover:bg-background-2"
          >
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                ACCENT_AVATAR[m.accent]
              )}
            >
              {avatarText(m.displayName, m.icon)}
            </div>
            <span className="text-sm font-medium">{m.displayName}</span>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-foreground-muted">
              <span className={cn('size-1.5 rounded-full', STATUS_DOT[m.status])} />
              {STATUS_LABEL[m.status]}
            </span>
            <RelativeTime
              value={m.createdAt}
              compact
              ago
              className="font-mono text-[10px] text-foreground-passive"
            />
            <span className="font-mono text-[10px] text-foreground-muted">@{m.handle}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

function MessageRow({
  message,
  byId,
  byHandle,
  onOpenMember,
  onOpenSession,
}: {
  message: RoomMessage;
  byId: Map<string, RoomMember>;
  byHandle: Map<string, RoomMember>;
  onOpenMember: OpenTab;
  onOpenSession: OpenTab;
}) {
  const { t } = useTranslation();
  // System = the referee's voice: a small centered line, with @handles as pills.
  if (message.kind === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <div className="text-center text-xs italic text-foreground-muted">
          {renderBody(message.body, byHandle, onOpenMember)}
          <span className="mx-1 text-foreground-passive">·</span>
          <RelativeTime
            value={message.createdAt}
            compact
            ago
            className="text-[10px] not-italic text-foreground-passive"
          />
        </div>
      </div>
    );
  }
  const author = message.authorMemberId ? byId.get(message.authorMemberId) : undefined;
  const accent = author?.accent ?? 'terra';
  const name = author?.displayName ?? 'You';
  const sessionRef = message.sessionRef;
  const openSession = sessionRef ? () => onOpenSession(sessionRef) : undefined;
  // Avatar/name open the agent's detail tab — only for real agents (the human
  // lead has no entity to show).
  const openDetail = author?.runtime ? () => onOpenMember(author.id) : undefined;

  return (
    <div className="flex gap-3 py-2.5">
      {openDetail ? (
        <button
          type="button"
          onClick={openDetail}
          title={t('agentRoom.viewAgent')}
          className={cn(
            'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold transition-opacity hover:opacity-80',
            ACCENT_AVATAR[accent]
          )}
        >
          {avatarText(name, author?.icon)}
        </button>
      ) : (
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
            ACCENT_AVATAR[accent]
          )}
        >
          {avatarText(name, author?.icon)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {openDetail ? (
            <button
              type="button"
              onClick={openDetail}
              title={t('agentRoom.viewAgent')}
              className={cn(
                'cursor-pointer text-sm font-semibold hover:underline',
                ACCENT_TEXT[accent]
              )}
            >
              {name}
            </button>
          ) : (
            <span className={cn('text-sm font-semibold', ACCENT_TEXT[accent])}>{name}</span>
          )}
          {message.kind === 'handoff' && (
            <span className="rounded bg-background-2 px-1.5 py-px text-[10px] text-foreground-muted">
              {t('agentRoom.handoff')}
            </span>
          )}
          <RelativeTime
            value={message.createdAt}
            compact
            ago
            className="shrink-0 text-[11px] text-foreground-passive"
          />
          {openSession && (
            <button
              type="button"
              onClick={openSession}
              className="ml-auto flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
            >
              <TerminalSquare className="size-3" />
              {t('agentRoom.openSession')}
            </button>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {renderBody(message.body, byHandle, onOpenMember)}
        </div>
      </div>
    </div>
  );
}

/** Render @handles as colored pills; an agent pill opens that agent's detail tab. */
function renderBody(body: string, byHandle: Map<string, RoomMember>, onOpenMember: OpenTab) {
  const parts = body.split(/(@[a-z0-9_-]+)/gi);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const member = byHandle.get(part.slice(1).toLowerCase());
      if (member) {
        const cls = cn('rounded px-1 py-px text-[13px] font-medium', ACCENT_MENTION[member.accent]);
        // Real agents open their detail tab; the human lead (@you) is a plain pill.
        return member.runtime ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpenMember(member.id)}
            className={cn(cls, 'cursor-pointer hover:underline')}
          >
            @{member.displayName}
          </button>
        ) : (
          <span key={i} className={cls}>
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
  icon: string;
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
      {
        kind: 'mention',
        handle: 'all',
        displayName: 'Everyone',
        icon: '',
        accent: 'slate',
        status: null,
      },
      ...members
        .filter((m) => m.role !== 'lead')
        .map(
          (m): MentionItem => ({
            kind: 'mention',
            handle: m.handle,
            displayName: m.displayName,
            icon: m.icon,
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
    <div className="relative shrink-0 border-t border-border px-5 py-3">
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
                    {avatarText(s.displayName, s.icon)}
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
          className="max-h-40 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none field-sizing-content placeholder:text-foreground-muted"
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
