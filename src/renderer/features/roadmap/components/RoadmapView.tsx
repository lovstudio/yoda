import {
  BookOpen,
  BookText,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  FlaskConical,
  Hammer,
  MessageSquareShare,
  Microscope,
  Milestone,
  Minus,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import {
  getReportCounts,
  getRoadmapCell,
  getRoadmapReport,
  getRuntimeProgress,
  ROADMAP_CATEGORIES,
  ROADMAP_RUNTIMES,
  type RoadmapFeature,
  type RoadmapStatus,
} from '../roadmap-data';

const STATUS_CONFIG: Record<
  RoadmapStatus,
  { Icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  shipped: { Icon: CircleCheck, className: 'text-foreground-diff-added' },
  testing: { Icon: FlaskConical, className: 'text-foreground-diff-modified' },
  inProgress: { Icon: Hammer, className: 'text-status-in-progress' },
  researching: { Icon: Microscope, className: 'text-foreground-muted' },
  planned: { Icon: CircleDashed, className: 'text-foreground-passive' },
  na: { Icon: Minus, className: 'text-foreground-passive/50' },
};

const STATUS_ORDER: readonly RoadmapStatus[] = [
  'shipped',
  'testing',
  'inProgress',
  'researching',
  'planned',
  'na',
];

const MATRIX_GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: `minmax(200px, 1.6fr) repeat(${ROADMAP_RUNTIMES.length}, minmax(88px, 1fr))`,
};

/**
 * Public roadmap: the runtime capability matrix — what Yoda has shipped,
 * is testing, or is still researching for each agent runtime. Content lives
 * in roadmap-data.ts; strings in i18n under `roadmap.*`.
 */
/** `embedded` drops the outer scroll shell + header for hosting inside settings. */
export function RoadmapView({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const showFeedbackModal = useShowModal('feedbackModal');

  const content = (
    <>
      <BookManifestoSection />

      <RuntimeMatrixSection />

      <section className="flex items-center justify-between gap-4 rounded-xl border border-border/70 p-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground">{t('roadmap.cta.title')}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('roadmap.cta.desc')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => showFeedbackModal({})}>
          <MessageSquareShare className="size-3.5" />
          {t('roadmap.cta.button')}
        </Button>
      </section>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-8">{content}</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Milestone className="size-4 text-foreground-muted" />
            <h1 className="text-lg font-semibold">{t('roadmap.title')}</h1>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('roadmap.subtitle')}</p>
        </header>

        {content}
      </div>
    </div>
  );
}

function BookManifestoSection() {
  const { t } = useTranslation();
  const counts = getReportCounts();
  const total = counts.published + counts.draft + counts.planned;

  return (
    <section className="flex gap-4 rounded-xl border border-border/70 p-5">
      <BookOpen className="mt-0.5 size-5 shrink-0 text-foreground-muted" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">{t('roadmap.book.bookTitle')}</h2>
          <span className="text-xs text-foreground-muted">{t('roadmap.book.bookSubtitle')}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('roadmap.book.desc')}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-muted">
          <span className="font-medium text-foreground">
            {t('roadmap.book.chapterCount', { count: total })}
          </span>
          <span>
            {t('roadmap.report.published')} {counts.published}
          </span>
          <span>
            {t('roadmap.report.draft')} {counts.draft}
          </span>
          <span>
            {t('roadmap.report.planned')} {counts.planned}
          </span>
        </div>
      </div>
    </section>
  );
}

function RuntimeMatrixSection() {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('roadmap.matrix.title')}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('roadmap.matrix.desc')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {STATUS_ORDER.map((status) => {
          const { Icon, className } = STATUS_CONFIG[status];
          return (
            <span
              key={status}
              className="flex items-center gap-1.5 text-[11px] text-foreground-muted"
            >
              <Icon className={cn('size-3.5', className)} />
              {t(`roadmap.status.${status}`)}
            </span>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <div className="min-w-[560px]">
          <MatrixHeader />
          {ROADMAP_CATEGORIES.map((category) => (
            <React.Fragment key={category.id}>
              <div className="border-b border-border/40 bg-background-1 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground-passive">
                {t(`roadmap.categories.${category.id}`)}
              </div>
              {category.features.map((feature) => (
                <MatrixFeatureRow key={feature.id} feature={feature} />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function MatrixHeader() {
  const { t } = useTranslation();

  return (
    <div className="grid border-b border-border/70" style={MATRIX_GRID_STYLE}>
      <div className="px-4 py-3 text-xs font-medium text-foreground-muted">
        {t('roadmap.matrix.featureColumn')}
      </div>
      {ROADMAP_RUNTIMES.map(({ id, upcoming }) => {
        const info = agentConfig[id];
        const progress = getRuntimeProgress(id);
        return (
          <div key={id} className="flex flex-col items-center gap-1.5 px-2 py-3">
            <span className="flex items-center gap-1.5">
              <AgentLogo
                logo={info.logo}
                alt={info.alt}
                isSvg={info.isSvg}
                invertInDark={info.invertInDark}
                className="size-4 shrink-0"
              />
              <span className="truncate text-xs font-medium text-foreground">{info.name}</span>
            </span>
            {upcoming ? (
              <Badge variant="secondary" className="text-[10px]">
                {t('roadmap.matrix.upcoming')}
              </Badge>
            ) : (
              <span className="flex w-full max-w-24 items-center gap-1.5">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-background-2">
                  <span
                    className="block h-full rounded-full bg-foreground-diff-added"
                    style={{
                      width: `${progress.total > 0 ? (progress.shipped / progress.total) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground-passive">
                  {progress.shipped}/{progress.total}
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MatrixFeatureRow({ feature }: { feature: RoadmapFeature }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);
  const report = getRoadmapReport(feature);
  const notes = ROADMAP_RUNTIMES.map(({ id }) => ({
    runtimeId: id,
    noteKey: getRoadmapCell(feature, id).noteKey,
  })).filter((entry): entry is { runtimeId: RuntimeId; noteKey: string } => Boolean(entry.noteKey));

  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="grid w-full items-center text-left transition-colors hover:bg-background-1"
        style={MATRIX_GRID_STYLE}
      >
        <span className="flex items-center gap-1.5 px-4 py-2.5">
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-foreground-passive transition-transform',
              expanded && 'rotate-90'
            )}
          />
          <span className="truncate text-sm text-foreground">
            {t(`roadmap.features.${feature.id}.name`)}
          </span>
          {report.status !== 'planned' && (
            <BookText className="size-3 shrink-0 text-foreground-passive" />
          )}
        </span>
        {ROADMAP_RUNTIMES.map(({ id }) => (
          <MatrixCell key={id} feature={feature} runtimeId={id} />
        ))}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 bg-background-1/50 px-9 pb-3 pt-1">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(`roadmap.features.${feature.id}.desc`)}
          </p>
          {notes.map(({ runtimeId, noteKey }) => {
            const info = agentConfig[runtimeId];
            return (
              <span key={runtimeId} className="flex items-start gap-2 text-xs">
                <AgentLogo
                  logo={info.logo}
                  alt={info.alt}
                  isSvg={info.isSvg}
                  invertInDark={info.invertInDark}
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <span className="leading-relaxed text-foreground-muted">
                  {t(`roadmap.notes.${noteKey}`)}
                </span>
              </span>
            );
          })}
          <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <BookText className="size-3.5 shrink-0 text-foreground-passive" />
            {report.url ? (
              <a
                href={report.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              >
                {t('roadmap.report.read')}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span>
                {t('roadmap.report.statusLine', {
                  status: t(`roadmap.report.${report.status}`),
                })}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function MatrixCell({ feature, runtimeId }: { feature: RoadmapFeature; runtimeId: RuntimeId }) {
  const { t } = useTranslation();
  const cell = getRoadmapCell(feature, runtimeId);
  const { Icon, className } = STATUS_CONFIG[cell.status];

  return (
    <span className="flex justify-center px-2 py-2.5">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Icon className={cn('size-4', className)} />
        </TooltipTrigger>
        <TooltipContent>
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t(`roadmap.status.${cell.status}`)}</span>
            {cell.noteKey && (
              <span className="text-background/80">{t(`roadmap.notes.${cell.noteKey}`)}</span>
            )}
          </span>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
