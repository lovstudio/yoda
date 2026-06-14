import { Boxes, Puzzle } from 'lucide-react';
import React, { type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import PluginsView from '@renderer/features/plugins/PluginsView';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import SkillsView from './components/SkillsView';

type SkillsViewParams = {
  focusSkillId?: string;
};

/** Which catalog the unified Skills/Plugins view is showing. */
type Surface = 'skills' | 'plugins';

const SURFACE_STORAGE_KEY = 'yoda.catalogSurface';

function loadStoredSurface(): Surface {
  try {
    return window.localStorage.getItem(SURFACE_STORAGE_KEY) === 'plugins' ? 'plugins' : 'skills';
  } catch {
    return 'skills';
  }
}

/** Segmented [Skills | Plugins] control rendered into each view's toolbar. */
const SurfaceToggle: React.FC<{ value: Surface; onChange: (value: Surface) => void }> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="icon-sm"
      multiple={false}
      value={[value]}
      onValueChange={([next]) => {
        if (next) onChange(next as Surface);
      }}
      aria-label={t('plugins.surface.ariaLabel')}
      className="shrink-0"
    >
      <ToggleGroupItem value="skills" aria-label={t('plugins.surface.skills')}>
        <Boxes className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="plugins" aria-label={t('plugins.surface.plugins')}>
        <Puzzle className="h-3.5 w-3.5" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
};

export function SkillsTitlebar() {
  return <Titlebar />;
}

export function SkillsWrapView({ children }: PropsWithChildren<SkillsViewParams>) {
  return <>{children}</>;
}

export function SkillsMainPanel() {
  const [surface, setSurface] = React.useState<Surface>(loadStoredSurface);

  const changeSurface = React.useCallback((next: Surface) => {
    setSurface(next);
    try {
      window.localStorage.setItem(SURFACE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const toggle = <SurfaceToggle value={surface} onChange={changeSurface} />;

  return surface === 'plugins' ? (
    <PluginsView surfaceControl={toggle} />
  ) : (
    <SkillsView surfaceControl={toggle} />
  );
}

export const skillsView = {
  WrapView: SkillsWrapView,
  TitlebarSlot: SkillsTitlebar,
  MainPanel: SkillsMainPanel,
};
