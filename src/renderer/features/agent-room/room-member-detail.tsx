import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Pencil, TerminalSquare, Users, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomMember } from '@shared/team-room';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { AvatarInput, type AvatarFileError } from '@renderer/lib/components/avatar-input';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { ACCENT_AVATAR, STATUS_DOT, STATUS_LABEL } from './accent';
import { agentRoomStore } from './agent-room-store';
import { taskRoomQueryKey } from './task-room-chat';

/** Look up a member in the (singleton) loaded room snapshot. */
function memberById(memberId: string): RoomMember | undefined {
  return agentRoomStore.snapshot?.members.find((m) => m.id === memberId);
}

/** Tab label + icon for a `room-member` tab; resolves the member from the loaded room. */
export function roomMemberTabMeta(memberId: string): { label: string; icon: ReactNode } {
  const member = memberById(memberId);
  if (!member) return { label: 'agent', icon: <Users className="size-3.5" /> };
  return {
    label: member.displayName,
    icon: (
      <AvatarValue
        name={member.displayName}
        value={member.icon}
        className={cn('size-3.5 rounded text-[10px] font-semibold', ACCENT_AVATAR[member.accent])}
      />
    ),
  };
}

/**
 * Content of a `room-member` tab — a room member's identity / instructions, with
 * a shortcut to open its live session. Rendered inside the provisioned task view
 * (sidebar pin or main area), so it can drive the task's TabManagerStore.
 */
export const RoomMemberDetail = observer(function RoomMemberDetail({
  memberId,
}: {
  memberId: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { projectId, taskId } = useTaskViewContext();
  const { taskView, conversations } = useProvisionedTask();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [iconDraft, setIconDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Ensure the room is loaded even when the tab is restored without the chat
  // ever being opened (mirrors TaskRoomChat's load).
  const { data: room } = useQuery({
    queryKey: taskRoomQueryKey(projectId, taskId),
    queryFn: () => rpc.teamRooms.getRoomForTask(projectId, taskId),
  });
  const roomId = room?.room.id ?? null;
  useEffect(() => {
    if (roomId) void agentRoomStore.selectRoom(roomId);
  }, [roomId]);

  const member = memberById(memberId);

  useEffect(() => {
    if (!member || editing) return;
    setNameDraft(member.displayName);
    setIconDraft(member.icon);
  }, [editing, member]);

  const startEdit = () => {
    if (!member) return;
    setNameDraft(member.displayName);
    setIconDraft(member.icon);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (member) {
      setNameDraft(member.displayName);
      setIconDraft(member.icon);
    }
    setEditing(false);
  };

  const showAvatarFileError = (error: AvatarFileError) => {
    const key =
      error === 'too-large'
        ? 'common.avatarFileTooLarge'
        : error === 'unsupported'
          ? 'common.avatarUnsupported'
          : 'common.avatarReadFailed';
    toast({ title: t(key), variant: 'destructive' });
  };

  const saveProfile = async () => {
    if (!member || saving) return;
    const displayName = nameDraft.trim();
    if (!displayName) return;
    setSaving(true);
    try {
      await agentRoomStore.updateMemberProfile({
        roomId: member.roomId,
        memberId: member.id,
        displayName,
        icon: iconDraft.trim(),
      });
      setEditing(false);
    } catch (error) {
      toast({
        title: t('agentRoom.member.updateFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!member) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-foreground-muted">
        <Loader2 className="size-4 animate-spin" /> loading agent…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-start gap-3">
        {!editing && (
          <AvatarValue
            name={member.displayName}
            value={member.icon}
            className={cn(
              'size-11 rounded-xl text-base font-semibold',
              ACCENT_AVATAR[member.accent]
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex min-w-0 flex-col gap-2">
              <input
                aria-label={t('agentRoom.member.name')}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveProfile();
                  if (event.key === 'Escape') cancelEdit();
                }}
                className="h-8 w-full min-w-0 rounded-md border border-border bg-background-1 px-2 text-sm font-semibold outline-none focus:border-primary/60"
              />
              <AvatarInput
                id={`room-member-avatar-${member.id}`}
                name={nameDraft || member.displayName}
                value={iconDraft}
                onChange={setIconDraft}
                inputLabel={t('agentRoom.member.avatar')}
                placeholder={t('common.avatarPlaceholder')}
                uploadTitle={t('common.uploadPhoto')}
                clearTitle={t('common.clearAvatar')}
                onFileError={showAvatarFileError}
                previewClassName={cn('size-11 rounded-xl text-base', ACCENT_AVATAR[member.accent])}
                onInputKeyDown={(event) => {
                  if (event.key === 'Enter') void saveProfile();
                  if (event.key === 'Escape') cancelEdit();
                }}
              />
            </div>
          ) : (
            <div className="truncate text-base font-semibold">{member.displayName}</div>
          )}
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <span className="flex items-center gap-1">
              <span className={cn('size-2 rounded-full', STATUS_DOT[member.status])} />
              {STATUS_LABEL[member.status]}
            </span>
            <span className="font-mono">@{member.handle}</span>
          </div>
        </div>
        {editing ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving || !nameDraft.trim()}
              title={t('agentRoom.member.saveProfile')}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-background-1 text-primary transition-colors hover:bg-background-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              title={t('agentRoom.member.cancelEdit')}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-background-1 text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            title={t('agentRoom.member.editProfile')}
            className="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background-1 text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-foreground-muted">role</dt>
        <dd>{member.role}</dd>
        {member.runtime && (
          <>
            <dt className="text-foreground-muted">runtime</dt>
            <dd className="font-mono">{member.runtime}</dd>
          </>
        )}
      </dl>
      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold text-foreground-muted">
          {t('agentRoom.member.instructions')}
        </div>
        <div className="whitespace-pre-wrap rounded-lg border border-border bg-background-1 p-3 text-xs leading-relaxed">
          {member.systemPrompt?.trim() ? member.systemPrompt : t('agentRoom.member.noInstructions')}
        </div>
      </div>
      {member.conversationId && (
        <button
          type="button"
          onClick={() => {
            const conversationId = member.conversationId;
            if (!conversationId) return;
            void (async () => {
              // The agent's session was created in the main process and may not
              // be in the renderer store yet — there is no `conversation:created`
              // bridge. Load it first, or the tab resolves to no store and the
              // pane is blank.
              const loaded = await conversations.ensureConversation(conversationId);
              if (!loaded) return;
              taskView.tabManager.openConversationInSidebar(conversationId);
              taskView.setSidebarCollapsed(false);
            })();
          }}
          className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background-1 px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-primary hover:text-foreground"
        >
          <TerminalSquare className="size-3.5" /> {t('agentRoom.openSession')}
        </button>
      )}
    </div>
  );
});
