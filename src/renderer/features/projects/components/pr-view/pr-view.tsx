import { CheckIcon, ChevronDownIcon, Github, RefreshCw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrSortField } from '@shared/pull-requests';
import {
  usePrViewState,
  type LabelItem,
  type StatusFilter,
  type UserItem,
} from '@renderer/features/projects/components/pr-view/usePrViewState';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { SearchInput } from '@renderer/lib/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { PrSyncStatusCard } from './pr-sync-status-card';
import { PrVirtualList } from './pr-virtual-list';

const SORT_OPTIONS: { value: PrSortField; labelKey: string }[] = [
  { value: 'newest', labelKey: 'pullRequests.sort.newest' },
  { value: 'oldest', labelKey: 'pullRequests.sort.oldest' },
  { value: 'recently-updated', labelKey: 'pullRequests.sort.recentlyUpdated' },
];

function FilterButton({
  label,
  active,
  disabled,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={
          'flex items-center text-sm gap-1 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed ' +
          (active ? 'text-foreground font-medium' : 'text-foreground-muted')
        }
      >
        {label}
        <ChevronDownIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 gap-0">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function UserFilterPopover({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: UserItem[];
  selected: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const filtered = items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <FilterButton label={label} active={selected !== null} disabled={items.length === 0}>
      <Input
        className="mb-1 h-7 text-xs"
        placeholder={t('pullRequests.searchFilterPlaceholder', { label: label.toLowerCase() })}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <ul className="max-h-52 overflow-y-auto">
        {filtered.map((item) => (
          <li key={item.value}>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              onClick={() => onChange(selected === item.value ? null : item.value)}
            >
              {item.avatarUrl ? (
                <img
                  src={item.avatarUrl}
                  alt={item.label}
                  className="size-4 shrink-0 rounded-full"
                />
              ) : (
                <span className="size-4 shrink-0 rounded-full bg-muted-foreground/20" />
              )}
              <span className="flex-1 truncate text-left">{item.label}</span>
              {selected === item.value && (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" />
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-2 py-3 text-xs text-center text-muted-foreground">
            {t('common.noResults')}
          </li>
        )}
      </ul>
    </FilterButton>
  );
}

function LabelFilterPopover({
  items,
  selected,
  onChange,
}: {
  items: LabelItem[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const filtered = items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <FilterButton
      label={t('pullRequests.filters.label')}
      active={selected.length > 0}
      disabled={items.length === 0}
    >
      <Input
        className="mb-1 h-7 text-xs"
        placeholder={t('pullRequests.filters.searchLabels')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <ul className="max-h-52 overflow-y-auto">
        {filtered.map((item) => (
          <li key={item.value}>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              onClick={() => toggle(item.value)}
            >
              {item.color ? (
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: `#${item.color}` }}
                />
              ) : (
                <span className="size-3 shrink-0 rounded-full bg-muted-foreground/20" />
              )}
              <span className="flex-1 truncate text-left">{item.label}</span>
              {selected.includes(item.value) && (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" />
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-2 py-3 text-xs text-center text-muted-foreground">
            {t('common.noResults')}
          </li>
        )}
      </ul>
    </FilterButton>
  );
}

function FilterPill({
  avatarUrl,
  color,
  label,
  onRemove,
}: {
  avatarUrl?: string;
  color?: string;
  label: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
      {avatarUrl && <img src={avatarUrl} alt={label} className="size-3.5 rounded-full" />}
      {color && (
        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: `#${color}` }} />
      )}
      {label}
      <button
        className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
        onClick={onRemove}
        aria-label={t('pullRequests.filters.removeFilter', { label })}
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

export const PullRequestView = observer(function PullRequestView() {
  const { t } = useTranslation();
  const {
    params: { projectId },
  } = useParams('project');
  const repositoryUrl = getRepositoryStore(projectId)?.repositoryUrl ?? null;
  const { needsGhAuth } = useGithubContext();
  const { navigate } = useNavigate();

  const {
    statusFilter,
    sortFilter,
    query,
    setQuery,
    syncing,
    selectedAuthorLogin,
    setSelectedAuthorLogin,
    selectedLabelNames,
    setSelectedLabelNames,
    selectedAssigneeLogin,
    setSelectedAssigneeLogin,
    handleStatusChange,
    handleSortChange,
    handleRefresh,
    handleForceFullSync,
    removeLabel,
    prs,
    loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    authorItems,
    assigneeItems,
    labelItems,
    selectedAuthorItem,
    selectedAssigneeItem,
    selectedLabelItems,
    hasPills,
  } = usePrViewState(projectId, repositoryUrl);

  if (!repositoryUrl) {
    return (
      <div className="flex flex-col max-w-3xl mx-auto w-full h-full pt-6 px-6 min-h-0">
        <p className="text-sm text-muted-foreground text-center py-4">
          {t('pullRequests.unavailableWithSettings')}
        </p>
      </div>
    );
  }

  if (needsGhAuth) {
    return (
      <div className="flex flex-col max-w-3xl mx-auto w-full h-full pt-6 px-6 min-h-0">
        <div className="flex w-full flex-col items-center justify-center gap-5 rounded-md border border-border border-dashed p-8 mt-4">
          <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-background-2">
            <Github className="size-4 text-foreground-muted" />
          </span>
          <p className="text-center text-sm font-normal text-foreground-muted">
            {t('pullRequests.githubAuthRequired')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              navigate('settings', {
                tab: 'account',
              })
            }
          >
            {t('pullRequests.connectUserAccount')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col max-w-3xl mx-auto w-full h-full pt-6 px-6 min-h-0">
      {/* ── Header controls ── */}
      <div className="flex flex-col gap-4 border-b border-border pb-2">
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-between">
          <ToggleGroup
            value={[statusFilter]}
            onValueChange={(values) => {
              const next = values.find((v) => v !== statusFilter) ?? statusFilter;
              handleStatusChange(next as StatusFilter);
            }}
          >
            <ToggleGroupItem value="open">{t('pullRequests.open')}</ToggleGroupItem>
            <ToggleGroupItem value="not-open">{t('pullRequests.closed')}</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-2">
            <SearchInput
              placeholder={t('pullRequests.searchByTitleBranchNumber')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ContextMenu>
              <ContextMenuTrigger>
                <Button variant="outline" size="icon-sm" onClick={handleRefresh} disabled={syncing}>
                  <motion.div
                    animate={syncing ? { rotate: 360 } : {}}
                    transition={syncing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
                  >
                    <RefreshCw className="size-3.5" />
                  </motion.div>
                </Button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleForceFullSync} disabled={syncing}>
                  <RefreshCw className="size-4" />
                  {t('pullRequests.forceFullSync')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>

        {/* ── Sort + filter row ── */}
        <div className="flex gap-2 flex-wrap flex-col">
          <div className="flex items-center gap-2 flex-wrap justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-foreground-passive">
                {t('pullRequests.sort.label')}
              </span>
              <Select value={sortFilter} onValueChange={handleSortChange}>
                <SelectTrigger
                  size="sm"
                  className="w-auto border-none p-0 gap-1 text-foreground-muted hover:text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(({ value, labelKey }) => (
                    <SelectItem key={value} value={value}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground-passive">
                {t('pullRequests.filters.filterBy')}
              </span>
              <UserFilterPopover
                label={t('pullRequests.filters.author')}
                items={authorItems}
                selected={selectedAuthorLogin}
                onChange={setSelectedAuthorLogin}
              />
              <LabelFilterPopover
                items={labelItems}
                selected={selectedLabelNames}
                onChange={setSelectedLabelNames}
              />
              <UserFilterPopover
                label={t('pullRequests.filters.assignee')}
                items={assigneeItems}
                selected={selectedAssigneeLogin}
                onChange={setSelectedAssigneeLogin}
              />
            </div>
          </div>

          {/* ── Active filter pills ── */}
          {hasPills && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {selectedAuthorItem && (
                <FilterPill
                  label={selectedAuthorItem.label}
                  avatarUrl={selectedAuthorItem.avatarUrl}
                  onRemove={() => setSelectedAuthorLogin(null)}
                />
              )}
              {selectedLabelItems.map((l) => (
                <FilterPill
                  key={l.value}
                  label={l.label}
                  color={l.color}
                  onRemove={() => removeLabel(l.value)}
                />
              ))}
              {selectedAssigneeItem && (
                <FilterPill
                  label={selectedAssigneeItem.label}
                  avatarUrl={selectedAssigneeItem.avatarUrl}
                  onRemove={() => setSelectedAssigneeLogin(null)}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <PrVirtualList
        prs={prs}
        projectId={projectId}
        loading={loading}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
      <PrSyncStatusCard projectId={projectId} repositoryUrl={repositoryUrl} />
    </div>
  );
});
