import { QueryClientProvider } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { AccountSessionEvents } from './app/account-session-events';
import { AppMenuEvents } from './app/app-menu-events';
import { BootScreen } from './app/boot-screen';
import { ReviewOrchestrationEvents } from './app/review-orchestration-events';
import { WelcomeScreen } from './app/welcome';
import { Workspace } from './app/workspace';
import { IntegrationsProvider } from './features/integrations/integrations-provider';
import { Onboarding } from './features/onboarding/onboarding';
import { ComparisonWindow } from './features/tasks/comparison-window';
import { TaskTabWindow } from './features/tasks/task-window';
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
type OnboardingStep = 'sign-in';

const AppContent = observer(function AppContent() {
  const [view, setView] = useState<AppView>(() =>
    localStorage.getItem(HAS_SEEN_ONBOARDING) === 'true' ? 'workspace' : 'onboarding'
  );

  const { data: session, isLoading: sessionLoading } = useAccountSession();

  const isLoading = sessionLoading;

  // Boot splash: main/full-app windows only — detached task/comparison windows
  // pop open instantly without the kernel boot screen.
  const [bootScreenDone, setBootScreenDone] = useState(
    isTaskWindowLaunch || isComparisonWindowLaunch
  );

  // Computed once when queries first resolve while in onboarding. Never updated
  // after that so query refetches mid-onboarding cannot shrink the step list
  // and unmount active step components.
  const [frozenSteps, setFrozenSteps] = useState<OnboardingStep[] | null>(null);

  useEffect(() => {
    if (!isLoading && view === 'onboarding' && frozenSteps === null) {
      const computed: OnboardingStep[] = [];
      if (!session?.isSignedIn) computed.push('sign-in');
      setFrozenSteps(computed);
    }
  }, [view, isLoading, frozenSteps, session]);

  const stepsNeeded = frozenSteps ?? [];

  const handleOnboardingComplete = () => {
    localStorage.setItem(HAS_SEEN_ONBOARDING, 'true');
    setView('welcome');
  };

  const handleOpenSettingsFromMenu = useCallback(() => {
    if (isTaskWindowLaunch || isComparisonWindowLaunch) return false;
    if (view === 'onboarding' && stepsNeeded.length > 0) return false;
    setView('workspace');
    return true;
  }, [view, stepsNeeded.length]);

  const renderContent = () => {
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
      <FeatureFlagProvider>
        <AppContent />
      </FeatureFlagProvider>
    </QueryClientProvider>
  );
}
