import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  FolderPlus,
  FolderSearch,
  Gauge,
  Loader2,
  MonitorCheck,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Sparkles,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DoctorHealthStatus,
  DoctorIssue,
  DoctorRuntimeReport,
  DoctorSnapshot,
  DoctorWorkspaceReport,
} from '@shared/doctor';
import type { RuntimeId } from '@shared/runtime-registry';
import { RuntimeLogo } from '@renderer/features/agents/components/RuntimeLogo';
import {
  getAgentInstallErrorMessage,
  getAgentUninstallErrorMessage,
} from '@renderer/lib/components/agent-selector/agent-install';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';

type DoctorStep = 'environment' | 'configuration' | 'workspace' | 'score';
type DoctorDestination =
  | { view: 'agents'; runtimeId?: RuntimeId }
  | { view: 'skills' }
  | { view: 'mcp' }
  | { view: 'projects' };

const STEP_ICONS = {
  environment: MonitorCheck,
  configuration: Settings2,
  workspace: FolderSearch,
  score: Gauge,
} satisfies Record<DoctorStep, typeof MonitorCheck>;

const QUERY_KEY = ['doctor', 'snapshot'] as const;

export const DoctorModal = observer(function DoctorModal(_props: BaseModalProps<void>) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { navigate } = useNavigate();
  const queryClient = useQueryClient();
  const showAddProject = useShowModal('addProjectModal');
  const [step, setStep] = useState<DoctorStep>('environment');
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<RuntimeId | null>(null);
  const [pendingUninstallId, setPendingUninstallId] = useState<RuntimeId | null>(null);
  const [uninstallingId, setUninstallingId] = useState<RuntimeId | null>(null);
  const [runtimeSearch, setRuntimeSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const snapshotQuery = useQuery<DoctorSnapshot>({
    queryKey: QUERY_KEY,
    queryFn: () => rpc.doctor.scan(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const rescan = useMutation({
    mutationFn: () => rpc.doctor.scan({ refresh: true }) as Promise<DoctorSnapshot>,
    onSuccess: (snapshot) => queryClient.setQueryData(QUERY_KEY, snapshot),
    onError: (error) =>
      toast({
        title: t('doctor.scanFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      }),
  });
  const workspaceScan = useMutation({
    mutationFn: (projectId: string) =>
      rpc.doctor.scanWorkspace(projectId) as Promise<DoctorWorkspaceReport>,
  });

  const snapshot = snapshotQuery.data;
  const selectedRuntime =
    snapshot?.runtimes.find((runtime) => runtime.id === selectedRuntimeId) ??
    snapshot?.runtimes.find((runtime) => runtime.installed) ??
    null;

  useEffect(() => {
    if (!selectedRuntimeId && snapshot) {
      setSelectedRuntimeId(snapshot.runtimes.find((runtime) => runtime.installed)?.id ?? null);
    }
  }, [selectedRuntimeId, snapshot]);

  const refresh = async () => {
    await rescan.mutateAsync().catch(() => undefined);
  };

  const installRuntime = async (runtime: DoctorRuntimeReport) => {
    const result = await appState.dependencies.install(runtime.id);
    if (!result.success) {
      toast({
        title: t('doctor.installFailed', { name: runtime.name }),
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
      return;
    }
    toast({ title: t('doctor.installSuccess', { name: runtime.name }) });
    await refresh();
  };

  const toggleRuntime = async (runtime: DoctorRuntimeReport) => {
    await rpc.runtimeSettings.updateItem(runtime.id, { disabled: !runtime.disabled });
    toast({
      title: t(runtime.disabled ? 'doctor.enableSuccess' : 'doctor.disableSuccess', {
        name: runtime.name,
      }),
    });
    await refresh();
  };

  const uninstallRuntime = async (runtime: DoctorRuntimeReport) => {
    setUninstallingId(runtime.id);
    const result = await appState.dependencies.uninstall(runtime.id);
    setUninstallingId(null);
    if (!result.success) {
      toast({
        title: t('doctor.uninstallFailed', { name: runtime.name }),
        description: getAgentUninstallErrorMessage(result.error),
        variant: 'destructive',
      });
      return;
    }
    setPendingUninstallId(null);
    toast({ title: t('doctor.uninstallSuccess', { name: runtime.name }) });
    await refresh();
  };

  const openDestination = (destination: DoctorDestination) => {
    if (destination.view === 'skills') {
      navigate('skills');
      return;
    }
    if (destination.view === 'mcp') {
      navigate('settings', { tab: 'mcp' });
      return;
    }
    if (destination.view === 'agents') {
      navigate('settings', { tab: 'clis-models', runtimeId: destination.runtimeId });
      return;
    }
    navigate('projectsOverview');
    showAddProject({ strategy: 'local', mode: 'pick' });
  };

  return (
    <>
      <DialogHeader className="min-w-0 flex-1">
        <Stethoscope className="size-4 shrink-0 text-foreground-muted" />
        <DialogTitle className="shrink-0 text-sm font-medium normal-case tracking-normal text-foreground">
          {t('doctor.title')}
        </DialogTitle>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xs text-foreground-passive">{t('doctor.windowSubtitle')}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {snapshot ? (
              <span className="text-[11px] text-foreground-passive">
                {t('doctor.scannedAt', { time: formatTime(snapshot.generatedAt) })}
              </span>
            ) : null}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('doctor.rescan')}
              title={t('doctor.rescan')}
              disabled={rescan.isPending}
              onClick={() => void refresh()}
            >
              <RefreshCw className={cn('size-3.5', rescan.isPending && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </DialogHeader>
      <div className="flex h-[min(700px,calc(100dvh-7rem))] min-h-0 w-full overflow-hidden border-t border-border bg-background text-foreground">
        {snapshotQuery.isPending ? (
          <WindowState>
            <Loader2 className="size-5 animate-spin" />
            <span>{t('doctor.scanning')}</span>
          </WindowState>
        ) : snapshotQuery.isError || !snapshot ? (
          <WindowState>
            <XCircle className="size-5 text-destructive" />
            <span>{t('doctor.scanFailed')}</span>
            <Button size="sm" variant="outline" onClick={() => void snapshotQuery.refetch()}>
              {t('common.retry')}
            </Button>
          </WindowState>
        ) : (
          <div className="flex min-h-0 flex-1">
            <DoctorRail snapshot={snapshot} step={step} onStepChange={setStep} />
            <main className="@container min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-5xl px-6 py-6">
                {step === 'environment' ? (
                  <EnvironmentStep
                    snapshot={snapshot}
                    search={runtimeSearch}
                    onSearchChange={setRuntimeSearch}
                    onInstall={installRuntime}
                    onSelect={(runtime) => {
                      setSelectedRuntimeId(runtime.id);
                      setStep('configuration');
                    }}
                  />
                ) : null}
                {step === 'configuration' ? (
                  <ConfigurationStep
                    snapshot={snapshot}
                    selected={selectedRuntime}
                    onSelect={(runtimeId) => {
                      setPendingUninstallId(null);
                      setSelectedRuntimeId(runtimeId);
                    }}
                    onToggle={toggleRuntime}
                    onUninstall={uninstallRuntime}
                    pendingUninstallId={pendingUninstallId}
                    uninstallingId={uninstallingId}
                    onRequestUninstall={setPendingUninstallId}
                    onCancelUninstall={() => setPendingUninstallId(null)}
                    onOpenMain={openDestination}
                  />
                ) : null}
                {step === 'workspace' ? (
                  <WorkspaceStep
                    snapshot={snapshot}
                    search={projectSearch}
                    onSearchChange={setProjectSearch}
                    report={workspaceScan.data ?? null}
                    scanningProjectId={workspaceScan.isPending ? workspaceScan.variables : null}
                    error={workspaceScan.isError ? workspaceScan.error : null}
                    onScan={(projectId) => workspaceScan.mutate(projectId)}
                    onAddProject={() => openDestination({ view: 'projects' })}
                  />
                ) : null}
                {step === 'score' ? <ScoreStep snapshot={snapshot} /> : null}
              </div>
            </main>
          </div>
        )}
      </div>
    </>
  );
});

function DoctorRail({
  snapshot,
  step,
  onStepChange,
}: {
  snapshot: DoctorSnapshot;
  step: DoctorStep;
  onStepChange: (step: DoctorStep) => void;
}) {
  const { t } = useTranslation();
  const steps: DoctorStep[] = ['environment', 'configuration', 'workspace', 'score'];
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background-secondary/50 px-3 py-4">
      <div className="mb-5 flex items-center gap-3 px-2">
        <ScoreRing score={snapshot.score} status={snapshot.status} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{t(`doctor.status.${snapshot.status}`)}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-foreground-passive">
            {t('doctor.issueSummary', { count: snapshot.issues.length })}
          </div>
        </div>
      </div>
      <nav className="space-y-1" aria-label={t('doctor.stepsLabel')}>
        {steps.map((id, index) => {
          const Icon = STEP_ICONS[id];
          const active = step === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'step' : undefined}
              onClick={() => onStepChange(id)}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-background-2 text-foreground'
                  : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
              )}
            >
              <span className="w-4 font-mono text-[10px] text-foreground-passive">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Icon className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{t(`doctor.steps.${id}`)}</span>
              <ChevronRight
                className={cn('size-3 opacity-0 transition-opacity', active && 'opacity-60')}
              />
            </button>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-border px-2 pt-3 text-[10px] leading-relaxed text-foreground-passive">
        {t('doctor.staticProbeNote')}
      </div>
    </aside>
  );
}

function StepHeader({
  eyebrow,
  description,
  action,
}: {
  eyebrow: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{eyebrow}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground-muted">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function EnvironmentStep({
  snapshot,
  search,
  onSearchChange,
  onInstall,
  onSelect,
}: {
  snapshot: DoctorSnapshot;
  search: string;
  onSearchChange: (value: string) => void;
  onInstall: (runtime: DoctorRuntimeReport) => Promise<void>;
  onSelect: (runtime: DoctorRuntimeReport) => void;
}) {
  const { t } = useTranslation();
  const normalized = search.trim().toLocaleLowerCase();
  const runtimes = snapshot.runtimes.filter(
    (runtime) =>
      !normalized ||
      runtime.name.toLocaleLowerCase().includes(normalized) ||
      runtime.id.includes(normalized)
  );
  return (
    <>
      <StepHeader
        eyebrow={`01 · ${t('doctor.steps.environment')}`}
        description={t('doctor.environment.description')}
      />
      <div className="mb-4 grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
        <Metric value={snapshot.installedRuntimeCount} label={t('doctor.environment.installed')} />
        <Metric
          value={snapshot.availableRuntimeCount - snapshot.installedRuntimeCount}
          label={t('doctor.environment.available')}
        />
        <Metric
          value={snapshot.runtimes.filter((runtime) => runtime.disabled).length}
          label={t('doctor.environment.disabled')}
        />
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-passive" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('doctor.environment.search')}
          className="h-8 pl-8 text-xs"
        />
      </div>
      <section className="overflow-hidden rounded-lg border border-border">
        {runtimes.map((runtime) => (
          <RuntimeRow
            key={runtime.id}
            runtime={runtime}
            onInstall={onInstall}
            onSelect={onSelect}
          />
        ))}
      </section>
    </>
  );
}

const RuntimeRow = observer(function RuntimeRow({
  runtime,
  onInstall,
  onSelect,
}: {
  runtime: DoctorRuntimeReport;
  onInstall: (runtime: DoctorRuntimeReport) => Promise<void>;
  onSelect: (runtime: DoctorRuntimeReport) => void;
}) {
  const { t } = useTranslation();
  const installing = appState.dependencies.isInstalling(runtime.id);
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-border px-3 last:border-b-0">
      <RuntimeLogo runtimeId={runtime.id} name={runtime.name} className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{runtime.name}</span>
          {runtime.installed && runtime.version ? (
            <span className="font-mono text-[10px] text-foreground-passive">
              v{runtime.version}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-foreground-passive">
          {runtime.installed
            ? runtime.executablePath
            : runtime.installCommand || t('doctor.environment.manualInstall')}
        </div>
      </div>
      <StatusPill
        status={runtime.disabled ? 'inactive' : runtime.installed ? runtime.status : 'inactive'}
        label={
          runtime.disabled
            ? t('doctor.runtimeDisabled')
            : runtime.installed
              ? t(`doctor.status.${runtime.status}`)
              : t('doctor.notInstalled')
        }
      />
      {runtime.installed ? (
        <Button size="sm" variant="ghost" onClick={() => onSelect(runtime)}>
          {t('doctor.inspect')}
          <ChevronRight />
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!runtime.installCommand || installing}
          onClick={() => void onInstall(runtime)}
        >
          {installing ? <Loader2 className="animate-spin" /> : null}
          {t('doctor.install')}
        </Button>
      )}
    </div>
  );
});

function ConfigurationStep({
  snapshot,
  selected,
  onSelect,
  onToggle,
  onUninstall,
  pendingUninstallId,
  uninstallingId,
  onRequestUninstall,
  onCancelUninstall,
  onOpenMain,
}: {
  snapshot: DoctorSnapshot;
  selected: DoctorRuntimeReport | null;
  onSelect: (id: RuntimeId) => void;
  onToggle: (runtime: DoctorRuntimeReport) => Promise<void>;
  onUninstall: (runtime: DoctorRuntimeReport) => Promise<void>;
  pendingUninstallId: RuntimeId | null;
  uninstallingId: RuntimeId | null;
  onRequestUninstall: (id: RuntimeId) => void;
  onCancelUninstall: () => void;
  onOpenMain: (destination: DoctorDestination) => void;
}) {
  const { t } = useTranslation();
  const installed = snapshot.runtimes.filter((runtime) => runtime.installed);
  return (
    <>
      <StepHeader
        eyebrow={`02 · ${t('doctor.steps.configuration')}`}
        description={t('doctor.configuration.description')}
      />
      {installed.length === 0 ? (
        <EmptyState
          icon={<MonitorCheck />}
          title={t('doctor.configuration.emptyTitle')}
          description={t('doctor.configuration.emptyDescription')}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-3">
            {installed.map((runtime) => (
              <button
                key={runtime.id}
                type="button"
                aria-pressed={selected?.id === runtime.id}
                onClick={() => onSelect(runtime.id)}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected?.id === runtime.id
                    ? 'bg-background-2 text-foreground'
                    : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
                )}
              >
                <RuntimeLogo runtimeId={runtime.id} name={runtime.name} className="size-4" />
                {runtime.name}
                <HealthDot status={runtime.status} />
              </button>
            ))}
          </div>
          {selected ? (
            <RuntimeConfiguration
              runtime={selected}
              onToggle={onToggle}
              onUninstall={onUninstall}
              uninstallPending={pendingUninstallId === selected.id}
              uninstalling={uninstallingId === selected.id}
              onRequestUninstall={() => onRequestUninstall(selected.id)}
              onCancelUninstall={onCancelUninstall}
              onOpenMain={onOpenMain}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function RuntimeConfiguration({
  runtime,
  onToggle,
  onUninstall,
  uninstallPending,
  uninstalling,
  onRequestUninstall,
  onCancelUninstall,
  onOpenMain,
}: {
  runtime: DoctorRuntimeReport;
  onToggle: (runtime: DoctorRuntimeReport) => Promise<void>;
  onUninstall: (runtime: DoctorRuntimeReport) => Promise<void>;
  uninstallPending: boolean;
  uninstalling: boolean;
  onRequestUninstall: () => void;
  onCancelUninstall: () => void;
  onOpenMain: (destination: DoctorDestination) => void;
}) {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  const promptFiles = runtime.configFiles.filter((file) => file.kind === 'prompt');
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
        <ScoreRing score={runtime.score} status={runtime.status} compact />
        <div className="min-w-40 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{runtime.name}</span>
            <StatusPill status={runtime.status} label={t(`doctor.status.${runtime.status}`)} />
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-foreground-passive">
            {runtime.executablePath}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={changing}
          onClick={() => {
            setChanging(true);
            void onToggle(runtime).finally(() => setChanging(false));
          }}
        >
          {runtime.disabled ? <Power /> : <PowerOff />}
          {t(runtime.disabled ? 'doctor.enable' : 'doctor.disable')}
        </Button>
        {uninstallPending ? (
          <>
            <span className="text-xs text-foreground-muted">
              {t('doctor.uninstallConfirmInline', { name: runtime.name })}
            </span>
            <Button size="sm" variant="ghost" disabled={uninstalling} onClick={onCancelUninstall}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={uninstalling}
              onClick={() => void onUninstall(runtime)}
            >
              {uninstalling ? <Loader2 className="animate-spin" /> : null}
              {t('doctor.uninstall')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={onRequestUninstall}>
            {t('doctor.uninstall')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onOpenMain({ view: 'agents', runtimeId: runtime.id })}
        >
          {t('doctor.advanced')}
          <ArrowUpRight />
        </Button>
      </div>

      {runtime.harnessSupport === 'runtime-only' ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-border bg-background-secondary px-3 py-2 text-xs text-foreground-muted">
          <Circle className="mt-0.5 size-3.5 shrink-0" />
          {t('doctor.configuration.runtimeOnly')}
        </div>
      ) : null}

      <div className="space-y-3">
        <HarnessSection
          icon={<FileText />}
          title={t('doctor.configuration.prompt')}
          value={
            promptFiles.some((file) => file.exists)
              ? t('doctor.configuration.filesFound', {
                  count: promptFiles.filter((file) => file.exists).length,
                })
              : t('doctor.configuration.notConfigured')
          }
          detail={
            promptFiles.length > 0 ? (
              <div className="space-y-1.5">
                {promptFiles.map((file) => (
                  <ConfigFileRow key={file.path} file={file} />
                ))}
              </div>
            ) : (
              <p>{t('doctor.configuration.unsupportedPrompt')}</p>
            )
          }
        />
        <HarnessSection
          icon={<Sparkles />}
          title={t('doctor.configuration.skills')}
          value={t('doctor.configuration.skillSummary', {
            active: runtime.skills.active,
            disabled: runtime.skills.disabled,
            issues: runtime.skills.issueCount,
          })}
          action={
            <Button size="sm" variant="ghost" onClick={() => onOpenMain({ view: 'skills' })}>
              {t('doctor.manage')}
              <ArrowUpRight />
            </Button>
          }
          detail={
            <div>
              {runtime.skills.topUsed.length > 0 ? (
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-foreground-passive">
                    {t('doctor.configuration.topUsed')}
                  </div>
                  <div className="grid gap-1.5">
                    {runtime.skills.topUsed.map((skill) => (
                      <div
                        key={skill.skillKey}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="truncate text-foreground-muted">{skill.name}</span>
                        <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums text-foreground-passive">
                          <span>{t('doctor.configuration.calls', { count: skill.total })}</span>
                          {skill.lastUsedAt ? (
                            <>
                              <span aria-hidden>·</span>
                              <RelativeTime value={skill.lastUsedAt} compact ago />
                            </>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p>{t('doctor.configuration.noUsage')}</p>
              )}
            </div>
          }
        />
        <HarnessSection
          icon={<Server />}
          title="MCP"
          value={t('doctor.configuration.mcpSummary', {
            total: runtime.mcp.total,
            issues: runtime.mcp.issueCount,
          })}
          action={
            <Button size="sm" variant="ghost" onClick={() => onOpenMain({ view: 'mcp' })}>
              {t('doctor.manage')}
              <ArrowUpRight />
            </Button>
          }
          detail={
            runtime.mcp.servers.length > 0 ? (
              <div className="space-y-1.5">
                {runtime.mcp.servers.map((server) => (
                  <div key={server.name} className="flex items-center gap-2 text-xs">
                    {server.status === 'ready' ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                    ) : server.status === 'attention' ? (
                      <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <Circle className="size-3.5 shrink-0 text-foreground-passive" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground-muted">
                      {server.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-foreground-passive">
                      {server.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{t('doctor.configuration.noMcp')}</p>
            )
          }
        />
      </div>

      {runtime.issues.length > 0 ? (
        <div className="mt-5">
          <h2 className="mb-2 text-xs font-medium">{t('doctor.findings')}</h2>
          <IssueList issues={runtime.issues.slice(0, 8)} />
        </div>
      ) : null}
    </div>
  );
}

function HarnessSection({
  icon,
  title,
  value,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <span className="text-foreground-passive [&>svg]:size-4">{icon}</span>
        <span className="text-sm font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">{value}</span>
        {action}
      </div>
      <div className="px-4 py-3 text-xs leading-relaxed text-foreground-muted">{detail}</div>
    </section>
  );
}

function ConfigFileRow({ file }: { file: DoctorRuntimeReport['configFiles'][number] }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      {file.exists ? (
        <Check className="size-3.5 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="size-3.5 shrink-0 text-foreground-passive" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.path}</span>
      <span className="shrink-0 text-[10px] text-foreground-passive">
        {file.exists && file.bytes != null ? formatBytes(file.bytes) : t('doctor.notConfigured')}
      </span>
    </div>
  );
}

function WorkspaceStep({
  snapshot,
  search,
  onSearchChange,
  report,
  scanningProjectId,
  error,
  onScan,
  onAddProject,
}: {
  snapshot: DoctorSnapshot;
  search: string;
  onSearchChange: (value: string) => void;
  report: DoctorWorkspaceReport | null;
  scanningProjectId: string | null;
  error: Error | null;
  onScan: (projectId: string) => void;
  onAddProject: () => void;
}) {
  const { t } = useTranslation();
  const normalized = search.trim().toLocaleLowerCase();
  const projects = snapshot.projects.filter(
    (project) =>
      !normalized ||
      project.name.toLocaleLowerCase().includes(normalized) ||
      project.path.toLocaleLowerCase().includes(normalized)
  );
  return (
    <>
      <StepHeader
        eyebrow={`03 · ${t('doctor.steps.workspace')}`}
        description={t('doctor.workspace.description')}
        action={
          <Button size="sm" variant="outline" onClick={onAddProject}>
            <FolderPlus />
            {t('doctor.workspace.add')}
          </Button>
        }
      />
      <div className="grid min-h-[420px] grid-cols-1 overflow-hidden rounded-lg border border-border @3xl:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.4fr)]">
        <div className="border-b border-border @3xl:border-b-0 @3xl:border-r">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-foreground-passive" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t('doctor.workspace.search')}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onScan(project.id)}
                className={cn(
                  'flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-background-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  report?.projectId === project.id && 'bg-background-2'
                )}
              >
                {scanningProjectId === project.id ? (
                  <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                ) : (
                  <FolderSearch className="mt-0.5 size-3.5 shrink-0 text-foreground-passive" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{project.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-foreground-passive">
                    {project.path}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0 p-4">
          {error ? (
            <EmptyState
              icon={<XCircle />}
              title={t('doctor.workspace.scanFailed')}
              description={error.message}
            />
          ) : report ? (
            <WorkspaceReportView report={report} />
          ) : (
            <EmptyState
              icon={<FolderSearch />}
              title={t('doctor.workspace.selectTitle')}
              description={t('doctor.workspace.selectDescription')}
            />
          )}
        </div>
      </div>
    </>
  );
}

function WorkspaceReportView({ report }: { report: DoctorWorkspaceReport }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <ScoreRing score={report.score} status={report.status} compact />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{report.projectName}</h2>
          <div className="mt-0.5 truncate font-mono text-[10px] text-foreground-passive">
            {report.projectPath}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {report.runtimes.map((runtime) => (
          <section key={runtime.id} className="rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <RuntimeLogo runtimeId={runtime.id} className="size-4" />
              <span className="text-xs font-medium">
                {runtime.id === 'claude' ? 'Claude Code' : 'Codex'}
              </span>
              <span className="ml-auto font-mono text-xs tabular-nums">{runtime.score}</span>
              <HealthDot status={runtime.status} />
            </div>
            <div className="grid grid-cols-3 gap-px bg-border">
              <TinyMetric
                label={t('doctor.workspace.prompts')}
                value={runtime.promptFiles.length}
              />
              <TinyMetric label="Skills" value={runtime.skills} />
              <TinyMetric label="MCP" value={runtime.mcpServers} />
              <TinyMetric label={t('doctor.workspace.commands')} value={runtime.commands} />
              <TinyMetric label={t('doctor.workspace.subagents')} value={runtime.subagents} />
              <TinyMetric label={t('doctor.workspace.issues')} value={runtime.issues.length} />
            </div>
          </section>
        ))}
      </div>
      {report.issues.length > 0 ? (
        <div className="mt-4">
          <IssueList issues={report.issues} />
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-xs text-foreground-muted">
          <CheckCircle2 className="size-4 text-emerald-500" />
          {t('doctor.workspace.noIssues')}
        </div>
      )}
    </div>
  );
}

function ScoreStep({ snapshot }: { snapshot: DoctorSnapshot }) {
  const { t } = useTranslation();
  const installed = snapshot.runtimes.filter((runtime) => runtime.installed);
  return (
    <>
      <StepHeader
        eyebrow={`04 · ${t('doctor.steps.score')}`}
        description={t('doctor.score.description')}
      />
      <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-[220px_1fr]">
        <section className="flex flex-col items-center justify-center rounded-lg border border-border px-5 py-7 text-center">
          <ScoreRing score={snapshot.score} status={snapshot.status} large />
          <div className="mt-3 text-sm font-semibold">{t(`doctor.status.${snapshot.status}`)}</div>
          <p className="mt-1 text-xs leading-relaxed text-foreground-passive">
            {t('doctor.score.caption')}
          </p>
        </section>
        <section className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border px-4 py-3 text-xs font-medium">
            {t('doctor.score.byRuntime')}
          </div>
          {installed.map((runtime) => (
            <div
              key={runtime.id}
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <RuntimeLogo runtimeId={runtime.id} name={runtime.name} className="size-5" />
              <span className="min-w-0 flex-1 truncate text-sm">{runtime.name}</span>
              <span className="font-mono text-xs tabular-nums text-foreground-muted">
                {runtime.skills.active} Skills · {runtime.mcp.total} MCP
              </span>
              <span className="w-8 text-right font-mono text-sm tabular-nums">{runtime.score}</span>
              <HealthDot status={runtime.status} />
            </div>
          ))}
        </section>
      </div>
      <div className="mt-5">
        <h2 className="mb-2 text-xs font-medium">{t('doctor.score.priority')}</h2>
        {snapshot.issues.length > 0 ? (
          <IssueList issues={snapshot.issues} />
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-xs text-foreground-muted">
            <CheckCircle2 className="size-4 text-emerald-500" />
            {t('doctor.score.noIssues')}
          </div>
        )}
      </div>
      <div className="mt-4 rounded-md border border-border bg-background-secondary px-3 py-2 text-[11px] leading-relaxed text-foreground-passive">
        {t('doctor.score.method')}
      </div>
    </>
  );
}

function IssueList({ issues }: { issues: DoctorIssue[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {issues.map((issue) => (
        <div
          key={issue.id}
          className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
        >
          {issue.severity === 'error' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
          ) : issue.severity === 'warning' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          ) : (
            <Circle className="mt-0.5 size-3.5 shrink-0 text-foreground-passive" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium">{issue.title}</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-foreground-passive">
              {issue.detail}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScoreRing({
  score,
  status,
  compact = false,
  large = false,
}: {
  score: number;
  status: DoctorHealthStatus;
  compact?: boolean;
  large?: boolean;
}) {
  const size = large ? 112 : compact ? 50 : 64;
  const stroke = large ? 7 : 5;
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * 2 * radius;
  const tone =
    status === 'healthy'
      ? 'stroke-emerald-500'
      : status === 'attention'
        ? 'stroke-amber-500'
        : status === 'critical'
          ? 'stroke-red-500'
          : 'stroke-foreground-disabled';
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${score}/100`}
    >
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={tone}
        />
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-mono font-semibold tabular-nums',
          large ? 'text-2xl' : compact ? 'text-xs' : 'text-base'
        )}
      >
        {score}
      </span>
    </div>
  );
}

function StatusPill({ status, label }: { status: DoctorHealthStatus; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 gap-1 rounded-full px-1.5 text-[10px] font-normal',
        status === 'healthy' && 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
        status === 'attention' && 'border-amber-500/30 text-amber-600 dark:text-amber-400',
        status === 'critical' && 'border-red-500/30 text-red-600 dark:text-red-400',
        status === 'inactive' && 'text-foreground-passive'
      )}
    >
      <HealthDot status={status} />
      {label}
    </Badge>
  );
}

function HealthDot({ status }: { status: DoctorHealthStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'healthy' && 'bg-emerald-500',
        status === 'attention' && 'bg-amber-500',
        status === 'critical' && 'bg-red-500',
        status === 'inactive' && 'bg-foreground-disabled'
      )}
    />
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-4 py-3">
      <div className="font-mono text-lg tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-foreground-passive">{label}</div>
    </div>
  );
}

function TinyMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <div className="font-mono text-sm tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] text-foreground-passive">{label}</div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-8 text-center">
      <span className="mb-3 flex size-9 items-center justify-center rounded-full border border-border text-foreground-passive [&>svg]:size-4">
        {icon}
      </span>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-foreground-passive">{description}</p>
    </div>
  );
}

function WindowState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-foreground-muted">
      {children}
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
