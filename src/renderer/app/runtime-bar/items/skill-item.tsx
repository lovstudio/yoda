import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { buildAgentCommandInsertion } from '@shared/agent-command-prefix';
import type { CatalogSkill } from '@shared/skills/types';
import { WorkspaceSkillPopover } from '@renderer/app/workspace-skill-popover';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { log } from '@renderer/utils/logger';
import {
  RUNTIME_BAR_ACTION_CLASS,
  RUNTIME_BAR_ACTION_LABEL_CLASS,
  RuntimeBarSeparator,
} from '../bar-chrome';
import { useRuntimeBarSession } from '../session-context';

/**
 * Skills available to the session. Installing one only takes effect on the next
 * start, so the session offers to restart itself rather than pretending the
 * skill is already loaded.
 */
export const RuntimeBarSkillItem = observer(function RuntimeBarSkillItem() {
  const { t } = useTranslation();
  const showConfirmActionModal = useShowModal('confirmActionModal');
  const { provisionedTask, activeConversation, activeConversationId, runtimeId, connectionId } =
    useRuntimeBarSession();

  const handleSkillInstalled = useCallback(
    (skill: { key: string; displayName: string }) => {
      if (!provisionedTask || !activeConversation || connectionId) return;
      showConfirmActionModal({
        title: t('skills.quickSearch.reloadTitle'),
        description: t('skills.quickSearch.reloadDescription', { name: skill.displayName }),
        confirmLabel: t('skills.quickSearch.reloadConfirm'),
        variant: 'default',
        onSuccess: () =>
          void provisionedTask.conversations.restartConversation(
            activeConversation.id,
            undefined,
            undefined,
            skill.key
          ),
      });
    },
    [activeConversation, connectionId, provisionedTask, showConfirmActionModal, t]
  );

  /**
   * Stages the skill's agent-native command in the session's input line, at
   * whatever the cursor position already was, and leaves submitting to the user.
   */
  const handleInsertSkill = useCallback(
    (skill: CatalogSkill) => {
      const conversation =
        provisionedTask && activeConversationId
          ? provisionedTask.conversations.conversations.get(activeConversationId)
          : undefined;
      const sessionId = conversation?.session.sessionId;
      if (!sessionId || !runtimeId) {
        log.warn('[runtime-bar] skill insert skipped, no live session input', {
          skillId: skill.id,
          hasConversation: Boolean(conversation),
          runtimeId,
        });
        return;
      }
      void rpc.pty.sendInput(sessionId, buildAgentCommandInsertion(runtimeId, skill.id));
      conversation?.session.pty?.terminal.focus();
    },
    [activeConversationId, provisionedTask, runtimeId]
  );

  const openSkillsManagement = useCallback(() => {
    appState.navigation.navigate('skills');
  }, []);

  return (
    <>
      <RuntimeBarSeparator />
      <WorkspaceSkillPopover
        runtimeId={runtimeId}
        triggerClassName={RUNTIME_BAR_ACTION_CLASS}
        triggerLabelClassName={RUNTIME_BAR_ACTION_LABEL_CLASS}
        onInsertSkill={handleInsertSkill}
        onInstalled={handleSkillInstalled}
        onManageSkills={openSkillsManagement}
      />
    </>
  );
});
