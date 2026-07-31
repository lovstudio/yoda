import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { MAAS_GATEWAY_EXTENSION_ID } from '@shared/extensions';
import { AccountSessionEvents } from './app/account-session-events';
import { AiLabBuildEvents } from './app/ai-lab-build-events';
import { AppMenuEvents } from './app/app-menu-events';
import { BootScreen } from './app/boot-screen';
import { ReviewOrchestrationEvents } from './app/review-orchestration-events';
import { SettingsSyncAgent } from './app/settings-sync-agent';
import { WelcomeScreen } from './app/welcome';
import { Workspace } from './app/workspace';
import { AiLabAppWindow } from './features/ai-lab/ai-lab-window';
import {
  EXTENSION_MARKETPLACE_QUERY_KEY,
  listMarketplaceExtensions,
} from './features/extensions/extension-marketplace-query';
import { IntegrationsProvider } from './features/integrations/integrations-provider';
import { Onboarding } from './features/onboarding/onboarding';
import { getOnboardingSteps, type OnboardingStep } from './features/onboarding/onboarding-steps';
import { ComparisonWindow } from './features/tasks/comparison-window';
import { TaskTabWindow } from './features/tasks/task-window';
import { WorkspaceSettingsAgent } from './features/workspaces/workspace-settings-agent';
import { getAiLabWindowLaunchTarget, isAiLabWindowLaunch } from './lib/ai-lab-window-launch-target';
import {
  getComparisonWindowLaunchTarget,
  isComparisonWindowLaunch,
} from './lib/comparison-window-launch-target';
import { useAccountSession } from './lib/hooks/useAccount';
import { WorkspaceLayoutContextProvider } from './lib/layout/layout-provider';
import { WorkspaceViewProvider } from './lib/layout/provider';
import { FeatureFlagProvider } from './lib/providers/feature-flag-override-context';
import { GithubContextProvider } from './lib/providers/github-context-provider';
import { ThemeProvider } from './lib/providers/theme-provider';
import { TerminalPoolProvider } from './lib/pty/pty-pool-provider';
import { queryClient } from './lib/query-client';
import { isTaskWindowLaunch } from './lib/task-window-launch-target';
import { RightSidebarProvider } from './lib/ui/right-sidebar';
import { TooltipProvider } from './lib/ui/tooltip';

export const HAS_SEEN_ONBOARDING = 'yoda:has-seen-onboarding:v1';

type AppView = 'onboarding' | 'welcome' | 'workspace';

const AppContent = observer(function AppContent() {
  const [view, setView] = useState<AppView>(() =>
    localStorage.getItem(HAS_SEEN_ONBOARDING) === 'true' ? 'workspace' : 'onboarding'
  );

  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const { data: extensions = [], isLoading: extensionsLoading } = useQuery({
    queryKey: EXTENSION_MARKETPLACE_QUERY_KEY,
    queryFn: listMarketplaceExtensions,
    enabled: view === 'onboarding',
  });

  const isLoading = sessionLoading || (view === 'onboarding' && extensionsLoading);

  // Boot splash: main/full-app windows only — detached task/comparison/AI Lab windows
  // pop open instantly without the kernel boot screen.
  const [bootScreenDone, setBootScreenDone] = useState(
    isTaskWindowLaunch || isComparisonWindowLaunch || isAiLabWindowLaunch
  );

  // Computed once when queries first resolve while in onboarding. Never updated
  // after that so query refetches mid-onboarding cannot shrink the step list
  // and unmount active step components.
  const [frozenSteps, setFrozenSteps] = useState<OnboardingStep[] | null>(null);

  useEffect(() => {
    if (!isLoading && view === 'onboarding' && frozenSteps === null) {
      const gatewayInstalled = extensions.some(
        (extension) =>
          extension.manifest.id === MAAS_GATEWAY_EXTENSION_ID && extension.installation !== null
      );
      setFrozenSteps(
        getOnboardingSteps({
          isSignedIn: session?.isSignedIn ?? false,
          isMaasGatewayInstalled: gatewayInstalled,
        })
      );
    }
  }, [view, isLoading, frozenSteps, session, extensions]);

  const stepsNeeded = frozenSteps ?? [];

  const handleOnboardingComplete = () => {
    localStorage.setItem(HAS_SEEN_ONBOARDING, 'true');
    setView('welcome');
  };

  const handleOpenSettingsFromMenu = useCallback(() => {
    if (isTaskWindowLaunch || isComparisonWindowLaunch || isAiLabWindowLaunch) return false;
    if (view === 'onboarding' && stepsNeeded.length > 0) return false;
    setView('workspace');
    return true;
  }, [view, stepsNeeded.length]);

  const renderContent = () => {
    if (isAiLabWindowLaunch) {
      const target = getAiLabWindowLaunchTarget();
      return target ? <AiLabAppWindow target={target} /> : null;
    }
    if (isComparisonWindowLaunch) {
      const target = getComparisonWindowLaunchTarget();
      return target ? <ComparisonWindow target={target} /> : null;
    }
    if (isTaskWindowLaunch) {
      return <TaskTabWindow />;
    }
    if (isLoading || (view === 'onboarding' && frozenSteps === null)) {
      return null;
    }
    if (view === 'onboarding' && stepsNeeded.length > 0) {
      return <Onboarding steps={stepsNeeded} onComplete={handleOnboardingComplete} />;
    }
    return (
      <>
        <Workspace />
        {view === 'welcome' && <WelcomeScreen onGetStarted={() => window.location.reload()} />}
      </>
    );
  };

  return (
    <TooltipProvider delay={300}>
      <WorkspaceLayoutContextProvider>
        <TerminalPoolProvider>
          <GithubContextProvider>
            <IntegrationsProvider>
              <WorkspaceViewProvider>
                <AppMenuEvents onOpenSettings={handleOpenSettingsFromMenu} />
                <ReviewOrchestrationEvents />
                {!isTaskWindowLaunch && !isComparisonWindowLaunch && !isAiLabWindowLaunch && (
                  <AiLabBuildEvents />
                )}
                <RightSidebarProvider>
                  <ThemeProvider>
                    {renderContent()}
                    {!bootScreenDone && (
                      <BootScreen
                        ready={!isLoading && !(view === 'onboarding' && frozenSteps === null)}
                        onFinished={() => setBootScreenDone(true)}
                      />
                    )}
                  </ThemeProvider>
                </RightSidebarProvider>
              </WorkspaceViewProvider>
            </IntegrationsProvider>
          </GithubContextProvider>
        </TerminalPoolProvider>
      </WorkspaceLayoutContextProvider>
    </TooltipProvider>
  );
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AccountSessionEvents />
      <SettingsSyncAgent />
      <WorkspaceSettingsAgent />
      <FeatureFlagProvider>
        <AppContent />
      </FeatureFlagProvider>
    </QueryClientProvider>
  );
}
