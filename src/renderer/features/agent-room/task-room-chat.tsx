import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { RoomChat } from './agent-room-panel';
import { agentRoomStore } from './agent-room-store';
import { taskRoomQueryKey } from './team-room-queries';

/**
 * The team-room group chat for a task, embedded in the task's Overview tab when
 * the task was started from a 多智能体 paradigm. Drives the shared agentRoomStore
 * (live events + composer) and renders the existing RoomChat.
 */
export const TaskRoomChat = observer(function TaskRoomChat({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { data: room } = useQuery({
    queryKey: taskRoomQueryKey(projectId, taskId),
    queryFn: () => rpc.teamRooms.getRoomForTask(projectId, taskId),
  });
  const roomId = room?.room.id ?? null;

  useEffect(() => {
    if (roomId) void agentRoomStore.selectRoom(roomId);
  }, [roomId]);

  const snapshot = agentRoomStore.snapshot;
  if (!roomId) return null;
  if (!snapshot || snapshot.room.id !== roomId) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-foreground-muted">
        <Loader2 className="size-4 animate-spin" /> loading room…
      </div>
    );
  }
  return <RoomChat snapshot={snapshot} />;
});
