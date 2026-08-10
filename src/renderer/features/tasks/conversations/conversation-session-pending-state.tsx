import { SessionOpeningSurface } from '@renderer/features/tasks/components/session-opening-surface';

export function ConversationSessionPendingState({
  title,
  heading,
  description,
}: {
  title: string;
  heading: string;
  description: string;
}) {
  return (
    <SessionOpeningSurface
      surface="conversation-session-pending"
      title={title}
      heading={heading}
      description={description}
      progressMessage={description}
    />
  );
}
