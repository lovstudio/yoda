import { BranchPickerField } from './branch-picker-field';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { type FromBranchModeState } from './use-from-branch-mode';

interface FromBranchContentProps {
  state: FromBranchModeState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  initialConversation: InitialConversationState;
  connectionId?: string;
  featureWorkflow?: boolean;
}

export function FromBranchContent({
  state,
  projectId,
  currentBranch,
  isUnborn,
  initialConversation,
  connectionId,
  featureWorkflow,
}: FromBranchContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <InitialConversationField
        state={initialConversation}
        connectionId={connectionId}
        featureWorkflow={featureWorkflow}
      />
      <BranchPickerField
        state={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />
    </div>
  );
}
