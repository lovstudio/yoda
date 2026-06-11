import {
  AppWindow,
  Bot,
  ChevronRight,
  FileText,
  FolderOpen,
  Puzzle,
  RefreshCw,
  Server,
  SquareSlash,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { openProjectFileTab } from '@renderer/features/project-file/project-file-session';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import {
  FilePathActionsDropdown,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { HARNESS_RUNTIMES, type HarnessRuntimeId } from './harness-spec';
import {
  useHarnessData,
  type HarnessMdEntry,
  type HarnessMemoryFile,
  type HarnessRuntimeData,
} from './use-harness-data';

type MakeTarget = (relativePath: string, kind: 'file' | 'directory') => FilePathTarget;

export const HarnessPanel = observer(function HarnessPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const {
    params: { projectId },
  } = useParams('project');
  const project = asMounted(getProjectStore(projectId));
  const projectData = project?.data;

  const [runtimeId, setRuntimeId] = useState<HarnessRuntimeId>('claude');
  const { data, isLoading, error, refetch, isFetching } = useHarnessData(projectId, projectData);

  if (!project || !projectData) return null;

  const spec = HARNESS_RUNTIMES.find((runtime) => runtime.id === runtimeId);
  const runtimeData = data?.[runtimeId];

  const makeTarget: MakeTarget = (relativePath, kind) => ({
    absolutePath: joinProjectPath(projectData.path, relativePath),
    relativePath,
    kind,
    sshConnectionId: projectData.type === 'ssh' ? (projectData.connectionId ?? null) : null,
  });

  const openProject = async () => {
    const result = await rpc.app.openIn(
      projectData.type === 'ssh'
        ? {
            app: 'terminal',
            path: projectData.path,
            isRemote: true,
            sshConnectionId: projectData.connectionId ?? null,
          }
        : { app: 'finder', path: projectData.path }
    );

    if (!result.success) {
      toast({
        title: t('projects.harness.openFailed'),
        description: result.error,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 pt-6">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border pb-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[runtimeId]}
            className="rounded-lg overflow-hidden shadow-none h-7 border border-border"
            onValueChange={([value]) => {
              if (value) setRuntimeId(value as HarnessRuntimeId);
            }}
          >
            {HARNESS_RUNTIMES.map((runtime) => (
              <ToggleGroupItem key={runtime.id} value={runtime.id} size="sm">
                {t(`projects.harness.runtimes.${runtime.id}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              title={t('common.refresh')}
            >
              <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openProject()}>
              <FolderOpen className="size-3.5" />
              {t('projects.harness.openProject')}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Spinner size="sm" className="text-foreground-muted" />
          </div>
        ) : error ? (
          <EmptyState label={t('common.error')} description={String(error)} />
        ) : runtimeData && spec ? (
          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            <div className="grid gap-6">
              <Section
                icon={<FileText className="size-3.5" />}
                title={t('projects.harness.memoryTitle')}
                count={runtimeData.memoryFiles.length}
              >
                {runtimeData.memoryFiles.length === 0 ? (
                  <SectionEmpty
                    hint={t('projects.harness.memoryEmpty', { path: spec.memoryFiles[0] })}
                  />
                ) : (
                  <CardList>
                    {runtimeData.memoryFiles.map((file) => (
                      <MemoryCard key={file.relativePath} file={file} makeTarget={makeTarget} />
                    ))}
                  </CardList>
                )}
              </Section>

              <Section
                icon={<Puzzle className="size-3.5" />}
                title={t('projects.harness.skillsTitle')}
                count={runtimeData.skills.length}
              >
                {runtimeData.skills.length === 0 ? (
                  <SectionEmpty
                    hint={t('projects.harness.skillsEmpty', { path: spec.skillDirs[0] })}
                  />
                ) : (
                  <CardList>
                    {runtimeData.skills.map((skill) => (
                      <EntityRow
                        key={skill.id}
                        name={skill.displayName}
                        description={skill.description}
                        badges={
                          <>
                            {skill.disabled ? (
                              <Badge variant="secondary">{t('projects.harness.disabled')}</Badge>
                            ) : null}
                            {skill.validationIssueCount > 0 ? (
                              <Badge variant="destructive">
                                {t('projects.harness.issueCount', {
                                  count: skill.validationIssueCount,
                                })}
                              </Badge>
                            ) : null}
                          </>
                        }
                        sources={skill.sources}
                        sourceKind="directory"
                        makeTarget={makeTarget}
                      />
                    ))}
                  </CardList>
                )}
              </Section>

              {spec.commandDirs.length > 0 ? (
                <MdEntrySection
                  icon={<SquareSlash className="size-3.5" />}
                  title={t('projects.harness.commandsTitle')}
                  emptyHint={t('projects.harness.commandsEmpty', { path: spec.commandDirs[0] })}
                  entries={runtimeData.commands}
                  namePrefix="/"
                  makeTarget={makeTarget}
                />
              ) : null}

              {spec.subagentDirs.length > 0 ? (
                <MdEntrySection
                  icon={<Bot className="size-3.5" />}
                  title={t('projects.harness.subagentsTitle')}
                  emptyHint={t('projects.harness.subagentsEmpty', { path: spec.subagentDirs[0] })}
                  entries={runtimeData.subagents}
                  makeTarget={makeTarget}
                />
              ) : null}

              {spec.mcp ? (
                <Section
                  icon={<Server className="size-3.5" />}
                  title={t('projects.harness.mcpTitle')}
                  count={runtimeData.mcpServers.length}
                >
                  {runtimeData.mcpServers.length === 0 ? (
                    <SectionEmpty
                      hint={t('projects.harness.mcpEmpty', { path: spec.mcp.relativePath })}
                    />
                  ) : (
                    <CardList>
                      {runtimeData.mcpServers.map((server) => (
                        <EntityRow
                          key={server.name}
                          name={server.name}
                          description={server.detail}
                          sources={[server.sourcePath]}
                          sourceKind="file"
                          makeTarget={makeTarget}
                        />
                      ))}
                    </CardList>
                  )}
                </Section>
              ) : null}

              <DebugSection runtimeData={runtimeData} makeTarget={makeTarget} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Harness file dropdown: the shared path actions plus a project-scoped
 * "open in Yoda" action that opens the file in a top-level app tab
 * (full Monaco editing, no task workspace required).
 */
function HarnessFileDropdown({ target }: { target: FilePathTarget }) {
  const { t } = useTranslation();
  const {
    params: { projectId },
  } = useParams('project');

  return (
    <FilePathActionsDropdown target={target}>
      {target.kind === 'file' && target.relativePath ? (
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            openProjectFileTab(projectId, target.relativePath as string);
          }}
        >
          <AppWindow className="size-4" />
          {t('fileActions.openInMainArea')}
        </DropdownMenuItem>
      ) : null}
    </FilePathActionsDropdown>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-foreground-muted">
        {icon}
        <h3 className="text-xs font-medium uppercase">{title}</h3>
        {count !== undefined && count > 0 ? (
          <span className="text-xs text-foreground-passive">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function CardList({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-md border border-border">{children}</div>;
}

function SectionEmpty({ hint }: { hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-foreground-passive">
      {hint}
    </div>
  );
}

function MemoryCard({ file, makeTarget }: { file: HarnessMemoryFile; makeTarget: MakeTarget }) {
  const { t } = useTranslation();
  return (
    <Collapsible className="border-t border-border bg-background first:border-t-0">
      <div className="flex items-center gap-1 pr-2 hover:bg-background-1">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
          <ChevronRight className="size-3.5 shrink-0 text-foreground-passive transition-transform group-data-[panel-open]:rotate-90" />
          <span className="min-w-0 truncate font-mono text-sm text-foreground">
            {file.relativePath}
          </span>
          <span className="ml-auto shrink-0 text-xs text-foreground-passive">
            {formatBytes(file.totalSize)}
          </span>
        </CollapsibleTrigger>
        <HarnessFileDropdown target={makeTarget(file.relativePath, 'file')} />
      </div>
      <CollapsibleContent>
        <div className="border-t border-border bg-background-1 px-3 py-2">
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground-muted">
            {file.content}
          </pre>
          {file.truncated ? (
            <div className="mt-1 text-xs text-foreground-passive">
              {t('projects.harness.contentTruncated')}
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MdEntrySection({
  icon,
  title,
  emptyHint,
  entries,
  namePrefix = '',
  makeTarget,
}: {
  icon: ReactNode;
  title: string;
  emptyHint: string;
  entries: HarnessMdEntry[];
  namePrefix?: string;
  makeTarget: MakeTarget;
}) {
  return (
    <Section icon={icon} title={title} count={entries.length}>
      {entries.length === 0 ? (
        <SectionEmpty hint={emptyHint} />
      ) : (
        <CardList>
          {entries.map((entry) => (
            <EntityRow
              key={entry.path}
              name={`${namePrefix}${entry.name}`}
              description={entry.description}
              sources={[entry.path]}
              sourceKind="file"
              makeTarget={makeTarget}
            />
          ))}
        </CardList>
      )}
    </Section>
  );
}

function EntityRow({
  name,
  description,
  badges,
  sources,
  sourceKind,
  makeTarget,
}: {
  name: string;
  description: string;
  badges?: ReactNode;
  sources: string[];
  sourceKind: 'file' | 'directory';
  makeTarget: MakeTarget;
}) {
  return (
    <Collapsible className="border-t border-border bg-background first:border-t-0">
      <CollapsibleTrigger className="group flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-background-1">
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-foreground-passive transition-transform group-data-[panel-open]:rotate-90" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {badges}
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-foreground-passive">
              {description}
            </p>
          ) : null}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border bg-background-1 px-3 py-1">
          {sources.map((source) => (
            <div key={source} className="flex items-center gap-2 py-1">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
                {source}
              </code>
              <HarnessFileDropdown target={makeTarget(source, sourceKind)} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DebugSection({
  runtimeData,
  makeTarget,
}: {
  runtimeData: HarnessRuntimeData;
  makeTarget: MakeTarget;
}) {
  const { t } = useTranslation();
  const rows: { relativePath: string; exists: boolean; kind: 'file' | 'directory' }[] = [
    ...runtimeData.settingsFiles.map((file) => ({ ...file, kind: 'file' as const })),
    ...runtimeData.skillDirs.map((dir) => ({ ...dir, kind: 'directory' as const })),
    ...runtimeData.missingMemoryFiles.map((relativePath) => ({
      relativePath,
      exists: false,
      kind: 'file' as const,
    })),
  ];

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-foreground-passive hover:text-foreground-muted">
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        {t('projects.harness.debugTitle')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 overflow-hidden rounded-md border border-border">
          {rows.map((row) => (
            <div
              key={row.relativePath}
              className="flex items-center gap-2 border-t border-border bg-background px-3 py-2 first:border-t-0"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
                {row.relativePath}
              </code>
              <Badge variant={row.exists ? 'secondary' : 'outline'}>
                {row.exists ? t('projects.harness.available') : t('projects.harness.missing')}
              </Badge>
              <HarnessFileDropdown target={makeTarget(row.relativePath, row.kind)} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function joinProjectPath(basePath: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/^\/+/, '');
  if (!normalizedRelativePath) return basePath;
  const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/';
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${normalizedRelativePath.replace(
    /\//g,
    separator
  )}`;
}
