import { useTranslation } from 'react-i18next';
import { paradigmKind, singleParadigmKind } from '@shared/paradigms/kinds';
import type { ParadigmPanelProps } from './panel-context';
import { PARADIGM_PANELS } from './panel-registry';
import { ParadigmRosterEditor } from './roster-editor';

/**
 * A paradigm's configuration surface: the roster of Agents it runs with, followed
 * by whatever else the kind contributes.
 *
 * Nothing here is per-kind. A one-Agent paradigm and a five-Agent team are the same
 * list at different lengths, so the same editor renders both and the kind follows
 * from what the user leaves on the list.
 */
export function ParadigmConfigurationPanel(props: ParadigmPanelProps) {
  const { t } = useTranslation();
  const { entry, agents, roster, onRosterChange, onConfigurationChange } = props;
  const KindPanel = PARADIGM_PANELS[entry.kindId];
  // A single-Agent paradigm labels its one row with the seat it fills. Kinds that
  // declare no seat (a team) fall back to the vibe-coding seat's label, which is
  // only ever shown while the roster is down to one Agent anyway.
  const soleSlot = paradigmKind(entry.kindId).slots[0] ?? singleParadigmKind.slots[0];

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t-0 pt-0">
      <ParadigmRosterEditor
        members={roster}
        agents={agents}
        soleSlotLabel={t(soleSlot.labelKey)}
        soleSlotIconId={soleSlot.iconId}
        onChange={onRosterChange}
        onConfigurationChange={onConfigurationChange}
      />
      {KindPanel && <KindPanel {...props} />}
    </div>
  );
}
