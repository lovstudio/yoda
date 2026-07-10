import { FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { expandRuntimeHome, resolveRuntimePaths } from '@shared/runtime-paths';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { AgentSection } from './AgentSection';

export const AgentTabHooks: React.FC<{ agentId: RuntimeId }> = observer(function AgentTabHooks({
  agentId,
}) {
  const { t } = useTranslation();
  const provider = getRuntime(agentId);
  const paths = resolveRuntimePaths(agentId);

  if (!provider) return null;

  const supported = provider.supportsHooks === true;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <AgentSection
        title={t('agents.hooks.title')}
        description={t('agents.hooks.description', { name: provider.name })}
      >
        {!supported ? (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
            {t('agents.hooks.unsupported', { name: provider.name })}
          </p>
        ) : paths.hooks ? (
          <HookPathRow path={paths.hooks} />
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
            {t('agents.hooks.noPath')}
          </p>
        )}
      </AgentSection>
    </div>
  );
});

const HookPathRow: React.FC<{ path: string }> = ({ path }) => {
  const { t } = useTranslation();
  const handleOpen = async () => {
    const home = await rpc.app.getHomeDir();
    await rpc.app.openIn({ app: 'finder', path: expandRuntimeHome(path, home) });
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <code className="truncate font-mono text-xs text-foreground">{path}</code>
      <Button variant="ghost" size="sm" onClick={() => void handleOpen()}>
        <FolderOpen className="mr-1 h-3.5 w-3.5" />
        {t('agents.openInFinder')}
      </Button>
    </div>
  );
};
