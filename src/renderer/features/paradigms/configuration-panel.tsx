import { useTranslation } from 'react-i18next';
import { paradigmKind } from '@shared/paradigms/kinds';
import type { ParadigmPanelProps } from './panel-context';
import { PARADIGM_PANELS } from './panel-registry';
import { ParadigmSlotCard } from './slot-card';

/**
 * A paradigm's configuration surface: one Agent card per seat the kind declares,
 * followed by whatever else the kind contributes. Nothing here is per-kind — the
 * seats come from the descriptor and the extras from the panel registry, so a new
 * paradigm configures itself without touching the composer.
 */
export function ParadigmConfigurationPanel(props: ParadigmPanelProps) {
  const { t } = useTranslation();
  const { entry, agents, slotAgentId, onSlotAgentChange, onConfigurationChange } = props;
  const kind = paradigmKind(entry.kindId);
  const KindPanel = PARADIGM_PANELS[entry.kindId];

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t-0 pt-0">
      {kind.slots.map((slot) => {
        const selectedAgentId = slotAgentId(slot.storageKey);
        return (
          <ParadigmSlotCard
            key={slot.key}
            iconId={slot.iconId}
            label={t(slot.labelKey)}
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(agentId) => {
              if (agentId === selectedAgentId) return;
              onSlotAgentChange(slot.storageKey, agentId);
              onConfigurationChange();
            }}
            onConfigurationChange={onConfigurationChange}
          />
        );
      })}
      {KindPanel && <KindPanel {...props} />}
    </div>
  );
}
