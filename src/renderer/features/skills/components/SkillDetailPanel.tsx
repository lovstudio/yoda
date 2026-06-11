import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Hash,
  Loader2,
  Power,
  PowerOff,
  Route,
  Sparkles,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import type { CatalogSkill, SkillValidationIssue } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';
import { getSkillUsageStats, skillUsageStatsChangedEvent } from '../skill-usage-stats';
import SkillIconRenderer from './SkillIconRenderer';
import { useSkills } from './useSkills';

type TextStats = {
  characters: number;
  lines: number;
  tokens: number;
};

const CJK_REGEX = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
const hoverActionBaseClass = 'opacity-0 transition-opacity duration-150 focus-visible:opacity-100';

function estimateTokenCount(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;

  const cjkCharacters = normalized.match(CJK_REGEX)?.length ?? 0;
  const nonCjkCharacters = normalized.replace(CJK_REGEX, '').length;
  return Math.max(1, Math.ceil(nonCjkCharacters / 4) + cjkCharacters);
}

function getTextStats(text: string): TextStats {
  const trimmed = text.trim();
  return {
    characters: text.length,
    lines: trimmed ? text.split(/\r\n|\r|\n/).length : 0,
    tokens: estimateTokenCount(text),
  };
}

function skillFilePath(localPath: string, disabled = false): string {
  const separator = localPath.includes('\\') && !localPath.includes('/') ? '\\' : '/';
  return `${localPath.replace(/[\\/]+$/, '')}${separator}${
    disabled ? 'SKILL.md.disabled' : 'SKILL.md'
  }`;
}

function sourceLabel(source: CatalogSkill['source']): string {
  if (source === 'openai') return 'OpenAI';
  if (source === 'anthropic') return 'Anthropic';
  return 'Local';
}

function formatLastUsedAt(value: string | null, formatter: Intl.DateTimeFormat): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatter.format(date);
}

/** Full-page skill detail — rendered by the `skill` view as its own app tab. */
const SkillDetailPanel: React.FC<{ skillId: string }> = ({ skillId }) => {
  const { t } = useTranslation();
  const { catalog, isLoading: isCatalogLoading, install, uninstall, setDisabled } = useSkills();

  const { data: detailData, isFetching: isDetailLoading } = useQuery({
    queryKey: ['skills', 'detail', skillId],
    queryFn: async () => {
      const result = await rpc.skills.getDetail({ skillId });
      if (result.success && result.data) return result.data;
      throw new Error('Failed to load skill detail');
    },
  });

  const skill = detailData ?? catalog?.skills.find((s) => s.id === skillId) ?? null;

  if (!skill) {
    if (isCatalogLoading || isDetailLoading) {
      return (
        <div className="flex h-full items-center justify-center bg-background text-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="h-full bg-background text-foreground">
        <EmptyState label={t('skills.detail.unavailable')} description={skillId} />
      </div>
    );
  }

  return (
    <SkillDetailContent
      skill={skill}
      isLoadingDetail={isDetailLoading}
      onInstall={install}
      onUninstall={uninstall}
      onSetDisabled={setDisabled}
    />
  );
};

const SkillDetailContent: React.FC<{
  skill: CatalogSkill;
  isLoadingDetail: boolean;
  onInstall: (skillId: string) => Promise<boolean>;
  onUninstall: (skillId: string) => Promise<boolean>;
  onSetDisabled: (skillId: string, disabled: boolean) => Promise<boolean>;
}> = ({ skill, isLoadingDetail, onInstall, onUninstall, onSetDisabled }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [usageStats, setUsageStats] = useState(() => getSkillUsageStats(skill.id));

  const parsed = useMemo(
    () => (skill.skillMdContent ? parseFrontmatter(skill.skillMdContent) : null),
    [skill.skillMdContent]
  );
  const frontmatter = parsed?.frontmatter ?? skill.frontmatter;
  const body = parsed?.body.trim() ?? '';
  const contentStats = useMemo(
    () => getTextStats(skill.skillMdContent ?? ''),
    [skill.skillMdContent]
  );
  const promptStats = useMemo(() => getTextStats(skill.defaultPrompt ?? ''), [skill.defaultPrompt]);
  const localSkillFilePath = skill.localPath
    ? skillFilePath(skill.localPath, skill.disabled)
    : null;
  const codexCommand = useMemo(() => applyAgentCommandPrefix('codex', skill.id), [skill.id]);
  const claudeCommand = useMemo(() => applyAgentCommandPrefix('claude', skill.id), [skill.id]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    []
  );
  const lastUsedAt = formatLastUsedAt(usageStats.lastUsedAt, dateTimeFormatter);
  const usageDescription = lastUsedAt
    ? t('skills.detail.lastUsedAt', { time: lastUsedAt })
    : t('skills.detail.neverUsed');
  const validationIssues = skill.validationIssues ?? [];
  const descriptionText = frontmatter.description || skill.description;

  useEffect(() => {
    setUsageStats(getSkillUsageStats(skill.id));

    if (typeof window === 'undefined') return;

    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ skillId?: string }>).detail;
      if (!detail?.skillId || detail.skillId === skill.id) {
        setUsageStats(getSkillUsageStats(skill.id));
      }
    };
    const handleStorage = () => setUsageStats(getSkillUsageStats(skill.id));

    window.addEventListener(skillUsageStatsChangedEvent, handleChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(skillUsageStatsChangedEvent, handleChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [skill.id]);

  const handleInstall = useCallback(async () => {
    setIsProcessing(true);
    try {
      await onInstall(skill.id);
    } finally {
      setIsProcessing(false);
    }
  }, [skill.id, onInstall]);

  const handleUninstall = useCallback(async () => {
    setIsProcessing(true);
    try {
      await onUninstall(skill.id);
    } finally {
      setIsProcessing(false);
    }
  }, [skill.id, onUninstall]);

  const handleSetDisabled = useCallback(
    async (disabled: boolean) => {
      setIsProcessing(true);
      try {
        await onSetDisabled(skill.id, disabled);
      } finally {
        setIsProcessing(false);
      }
    },
    [skill.id, onSetDisabled]
  );

  const handleOpen = useCallback(() => {
    if (skill.localPath) void rpc.app.openIn({ app: 'terminal', path: skill.localPath });
  }, [skill.localPath]);

  const handleOpenSource = useCallback(() => {
    if (skill.sourceUrl) void rpc.app.openExternal(skill.sourceUrl);
  }, [skill.sourceUrl]);

  const handleRevealPath = useCallback(
    async (pathToReveal: string) => {
      try {
        const result = await rpc.app.openIn({ app: 'finder', path: pathToReveal, reveal: true });
        if (!result?.success) throw new Error(result?.error ?? t('common.unknownError'));
      } catch (error) {
        toast({
          title: t('skills.detail.showInFolderFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    },
    [t, toast]
  );

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        const result = await rpc.app.clipboardWriteText(text);
        if (!result?.success) throw new Error(result?.error ?? t('common.copyFailed'));
        toast({ title: t('common.copied') });
      } catch {
        toast({ title: t('common.copyFailed'), variant: 'destructive' });
      }
    },
    [t, toast]
  );

  const estimatedTokens =
    isLoadingDetail && !skill.skillMdContent
      ? t('common.loading')
      : skill.skillMdContent
        ? `~${numberFormatter.format(contentStats.tokens)}`
        : t('skills.detail.unavailable');

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <SkillIconRenderer skill={skill} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{skill.displayName}</h1>
            <div className="group/description mt-1 flex min-w-0 items-start gap-1.5">
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {descriptionText}
              </p>
              {descriptionText && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void handleCopy(descriptionText)}
                  aria-label={t('skills.detail.copyDescription')}
                  title={t('skills.detail.copyDescription')}
                  className={cn(
                    '-mt-1 shrink-0',
                    hoverActionBaseClass,
                    'group-hover/description:opacity-100 group-focus-within/description:opacity-100'
                  )}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant={skill.installed && !skill.disabled ? 'default' : 'secondary'}>
                {skill.installed
                  ? skill.disabled
                    ? t('skills.disabled')
                    : t('skills.installed')
                  : t('skills.detail.notInstalled')}
              </Badge>
              <Badge variant="outline">{sourceLabel(skill.source)}</Badge>
              <Badge variant="secondary" className="font-mono">
                {skill.id}
              </Badge>
            </div>
          </div>
          {/* Actions */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {skill.installed ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSetDisabled(!skill.disabled)}
                  disabled={isProcessing}
                >
                  {skill.disabled ? (
                    <Power className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <PowerOff className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {skill.disabled ? t('skills.enable') : t('skills.disable')}
                </Button>
                {skill.localPath && (
                  <Button variant="outline" size="sm" onClick={handleOpen}>
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    {t('common.open')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleUninstall()}
                  disabled={isProcessing}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t('skills.uninstall')}
                </Button>
              </>
            ) : (
              <ConfirmButton size="sm" onClick={() => void handleInstall()} disabled={isProcessing}>
                {isProcessing ? t('skills.installing') : t('skills.install')}
              </ConfirmButton>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile
              icon={FileText}
              label={t('skills.detail.estimatedTokens')}
              value={estimatedTokens}
            />
            <MetricTile
              icon={Hash}
              label={t('skills.detail.characters')}
              value={numberFormatter.format(contentStats.characters)}
            />
            <MetricTile
              icon={Route}
              label={t('skills.detail.callFrequency')}
              value={numberFormatter.format(usageStats.count)}
              description={usageDescription}
            />
            <MetricTile
              icon={CheckCircle2}
              label={t('skills.detail.lines')}
              value={numberFormatter.format(contentStats.lines)}
            />
          </div>

          {validationIssues.length > 0 && (
            <DetailSection title={t('skills.detail.validation')}>
              <div className="space-y-2">
                {validationIssues.map((issue) => (
                  <ValidationIssueRow
                    key={`${issue.agent}-${issue.code}-${issue.field}`}
                    issue={issue}
                  />
                ))}
              </div>
            </DetailSection>
          )}

          <DetailSection title={t('skills.detail.paths')}>
            {skill.localPath ? (
              <>
                <ValueRow
                  label={t('skills.detail.installPath')}
                  value={skill.localPath}
                  onCopy={() => void handleCopy(skill.localPath!)}
                  extraAction={
                    <ShowInFolderButton
                      label={t('skills.detail.showInFolder')}
                      onClick={() => void handleRevealPath(skill.localPath!)}
                    />
                  }
                />
                {localSkillFilePath && (
                  <ValueRow
                    label={t('skills.detail.skillFile')}
                    value={localSkillFilePath}
                    onCopy={() => void handleCopy(localSkillFilePath)}
                    extraAction={
                      <ShowInFolderButton
                        label={t('skills.detail.showInFolder')}
                        onClick={() => void handleRevealPath(localSkillFilePath)}
                      />
                    }
                  />
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('skills.detail.noLocalPath')}</p>
            )}
            {skill.sourceUrl && (
              <ValueRow
                label={t('skills.detail.sourceUrl')}
                value={skill.sourceUrl}
                onCopy={() => void handleCopy(skill.sourceUrl!)}
                extraAction={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleOpenSource}
                    aria-label={t('skills.detail.openSource')}
                    title={t('skills.detail.openSource')}
                    className={cn(
                      hoverActionBaseClass,
                      'group-hover/value-row:opacity-100 group-focus-within/value-row:opacity-100'
                    )}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                }
              />
            )}
          </DetailSection>

          <DetailSection title={t('skills.detail.invocation')}>
            <div className="grid gap-2 sm:grid-cols-2">
              <CommandCopyButton
                label="Codex"
                command={codexCommand}
                onCopy={() => void handleCopy(codexCommand)}
              />
              <CommandCopyButton
                label="Claude"
                command={claudeCommand}
                onCopy={() => void handleCopy(claudeCommand)}
              />
            </div>
          </DetailSection>

          {(frontmatter.license || frontmatter.compatibility || frontmatter['allowed-tools']) && (
            <DetailSection title={t('skills.detail.metadata')}>
              <div className="grid gap-2 sm:grid-cols-3">
                {frontmatter.license && (
                  <MetadataItem label={t('skills.detail.license')} value={frontmatter.license} />
                )}
                {frontmatter.compatibility && (
                  <MetadataItem
                    label={t('skills.detail.compatibility')}
                    value={frontmatter.compatibility}
                  />
                )}
                {frontmatter['allowed-tools'] && (
                  <MetadataItem
                    label={t('skills.detail.allowedTools')}
                    value={frontmatter['allowed-tools']}
                  />
                )}
              </div>
            </DetailSection>
          )}

          {skill.defaultPrompt && (
            <DetailSection
              title={t('skills.examplePrompt')}
              action={
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    ~{numberFormatter.format(promptStats.tokens)} {t('skills.detail.tokens')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void handleCopy(skill.defaultPrompt!)}
                    aria-label={t('skills.detail.copyPrompt')}
                    title={t('skills.detail.copyPrompt')}
                    className={cn(
                      hoverActionBaseClass,
                      'group-hover/detail-section:opacity-100 group-focus-within/detail-section:opacity-100'
                    )}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              }
            >
              <pre className="wrap-break-word whitespace-pre-wrap rounded-md bg-muted/30 px-3 py-2 text-xs text-foreground">
                {skill.defaultPrompt}
              </pre>
            </DetailSection>
          )}

          {body && (
            <DetailSection
              title={t('skills.detail.instructions')}
              action={
                skill.skillMdContent ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void handleCopy(skill.skillMdContent!)}
                    aria-label={t('skills.detail.copySkillMd')}
                    title={t('skills.detail.copySkillMd')}
                    className={cn(
                      hoverActionBaseClass,
                      'group-hover/detail-section:opacity-100 group-focus-within/detail-section:opacity-100'
                    )}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                ) : null
              }
            >
              <MarkdownRenderer
                content={body}
                variant="compact"
                className="rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
              />
            </DetailSection>
          )}
        </div>
      </div>
    </div>
  );
};

function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="group/detail-section space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
      {description && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{description}</div>
      )}
    </div>
  );
}

function ValueRow({
  label,
  value,
  onCopy,
  extraAction,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  extraAction?: React.ReactNode;
}) {
  return (
    <div className="group/value-row flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate font-mono text-xs text-foreground" title={value}>
          {value}
        </div>
      </div>
      {extraAction && (
        <div
          className={cn(
            hoverActionBaseClass,
            'group-hover/value-row:opacity-100 group-focus-within/value-row:opacity-100'
          )}
        >
          {extraAction}
        </div>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onCopy}
        aria-label={label}
        title={label}
        className={cn(
          'shrink-0',
          hoverActionBaseClass,
          'group-hover/value-row:opacity-100 group-focus-within/value-row:opacity-100'
        )}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ShowInFolderButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0"
    >
      <FolderOpen className="h-3.5 w-3.5" />
    </Button>
  );
}

function ValidationIssueRow({ issue }: { issue: SkillValidationIssue }) {
  return (
    <div
      className={cn(
        'flex min-w-0 gap-2 rounded-md border px-3 py-2 text-xs',
        issue.severity === 'error'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted/20 text-muted-foreground'
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        <div className="font-medium">Codex: {issue.message}</div>
        {issue.path && (
          <div className="truncate font-mono text-[10px] opacity-80" title={issue.path}>
            {issue.path}
          </div>
        )}
        {typeof issue.actual === 'number' && typeof issue.max === 'number' && (
          <div className="text-[10px] opacity-80">
            {issue.actual} / {issue.max}
          </div>
        )}
      </div>
    </div>
  );
}

function CommandCopyButton({
  label,
  command,
  onCopy,
}: {
  label: string;
  command: string;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        'group/command flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-left transition-colors',
        'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
      )}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
        <code className="mt-0.5 block truncate font-mono text-xs text-foreground">{command}</code>
      </div>
      <Copy
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground',
          hoverActionBaseClass,
          'group-hover/command:opacity-100 group-focus-visible/command:opacity-100'
        )}
      />
    </button>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

export default SkillDetailPanel;
