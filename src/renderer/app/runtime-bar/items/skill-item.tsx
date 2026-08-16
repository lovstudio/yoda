import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceSkillPopover } from '@renderer/app/workspace-skill-popover';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
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
  const { provisionedTask, activeConversation, connectionId } = useRuntimeBarSession();

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

  const openSkillsManagement = useCallback(() => {
    appState.navigation.navigate('skills');
  }, []);

  return (
    <>
      <RuntimeBarSeparator />
      <WorkspaceSkillPopover
        triggerClassName={RUNTIME_BAR_ACTION_CLASS}
        triggerLabelClassName={RUNTIME_BAR_ACTION_LABEL_CLASS}
        onInstalled={handleSkillInstalled}
        onManageSkills={openSkillsManagement}
      />
    </>
  );
});
