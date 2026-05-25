import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  gitRefToString,
  HEAD_REF,
  type GitRef,
  type ImageReadResult,
  type ImageUnavailableReason,
} from '@shared/git';
import type { Result } from '@shared/result';
import type { ActiveFile } from '@shared/view-state';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { formatBytes } from '@renderer/utils/formatBytes';

interface ImageDiffViewProps {
  projectId: string;
  workspaceId: string;
  activeFile: ActiveFile;
}

type SideState =
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string; mimeType: string; size: number }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: ImageUnavailableReason }
  | { status: 'error'; message: string };

type Side = 'original' | 'modified';

function unavailableMessage(reason: ImageUnavailableReason, t: TFunction): string {
  switch (reason) {
    case 'ssh':
      return t('diff.image.unavailableSsh');
    case 'unsupported':
      return t('diff.image.unavailableUnsupported');
    case 'too-large':
      return t('diff.image.unavailableTooLarge');
    case 'lfs-pointer':
      return t('diff.image.unavailableLfs');
    case 'git-error':
      return t('diff.image.unavailableGeneric');
  }
}

function fromImageReadResult(result: ImageReadResult): SideState {
  switch (result.kind) {
    case 'image':
      return {
        status: 'ready',
        dataUrl: result.image.dataUrl,
        mimeType: result.image.mimeType,
        size: result.image.size,
      };
    case 'missing':
      return { status: 'missing' };
    case 'unavailable':
      return { status: 'unavailable', reason: result.reason };
  }
}

type ImageRpcResult = Result<{ result: ImageReadResult }, unknown>;

async function loadGitImage(call: () => Promise<ImageRpcResult>): Promise<SideState> {
  const res = await call();
  if (!res.success) return { status: 'unavailable', reason: 'git-error' };
  return fromImageReadResult(res.data.result);
}

function loadFromRef(
  projectId: string,
  workspaceId: string,
  filePath: string,
  ref: GitRef
): Promise<SideState> {
  return loadGitImage(() =>
    rpc.git.getImageAtRef(projectId, workspaceId, filePath, gitRefToString(ref))
  );
}

async function loadFromDisk(
  projectId: string,
  workspaceId: string,
  filePath: string
): Promise<SideState> {
  const res = await rpc.fs.readImage(projectId, workspaceId, filePath);
  if (!res.success) return { status: 'unavailable', reason: 'git-error' };
  const image = res.data;
  if (!image?.success) {
    const error = image?.error ?? '';
    if (/not found/i.test(error)) return { status: 'missing' };
    return { status: 'unavailable', reason: 'git-error' };
  }
  if (!image.dataUrl) return { status: 'unavailable', reason: 'git-error' };
  return {
    status: 'ready',
    dataUrl: image.dataUrl,
    mimeType: image.mimeType ?? 'application/octet-stream',
    size: image.size ?? 0,
  };
}

function loadOriginal(
  projectId: string,
  workspaceId: string,
  activeFile: ActiveFile
): Promise<SideState> {
  const ref: GitRef = activeFile.group === 'staged' ? HEAD_REF : activeFile.originalRef;
  return loadFromRef(projectId, workspaceId, activeFile.path, ref);
}

function loadModified(
  projectId: string,
  workspaceId: string,
  activeFile: ActiveFile
): Promise<SideState> {
  switch (activeFile.group) {
    case 'disk':
      return loadFromDisk(projectId, workspaceId, activeFile.path);
    case 'staged':
      return loadGitImage(() => rpc.git.getImageAtIndex(projectId, workspaceId, activeFile.path));
    case 'git':
    case 'pr':
      return loadFromRef(
        projectId,
        workspaceId,
        activeFile.path,
        activeFile.modifiedRef ?? HEAD_REF
      );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryModifiedLoad(state: SideState): boolean {
  return (
    state.status === 'error' || (state.status === 'unavailable' && state.reason === 'git-error')
  );
}

async function loadModifiedWithTransientRetry(
  projectId: string,
  workspaceId: string,
  activeFile: ActiveFile
): Promise<SideState> {
  const delays = [120, 300, 600];
  let state = await loadModified(projectId, workspaceId, activeFile);

  for (const ms of delays) {
    if (!shouldRetryModifiedLoad(state)) return state;
    await delay(ms);
    state = await loadModified(projectId, workspaceId, activeFile);
  }

  return state;
}

function ImageSidePanel({ label, state, side }: { label: string; state: SideState; side: Side }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-wide text-foreground-muted">
          {label}
        </span>
        {state.status === 'ready' && (
          <span className="font-mono text-[10px] text-foreground-passive">
            {formatBytes(state.size)}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <ImageSideContent state={state} side={side} />
      </div>
    </div>
  );
}

function ImageSideContent({ state, side }: { state: SideState; side: Side }) {
  const { t } = useTranslation();

  switch (state.status) {
    case 'loading':
      return <div className="text-xs text-foreground-passive">{t('common.loading')}</div>;
    case 'missing':
      return (
        <div className="text-xs text-foreground-passive">
          {side === 'original' ? t('diff.image.fileAdded') : t('diff.image.fileDeleted')}
        </div>
      );
    case 'unavailable':
      return (
        <div className="text-xs text-foreground-passive">{unavailableMessage(state.reason, t)}</div>
      );
    case 'error':
      return <div className="text-xs text-foreground-passive">{state.message}</div>;
    case 'ready':
      return <PreviewImage state={state} alt={side} />;
  }
}

function PreviewImage({
  state,
  alt,
}: {
  state: Extract<SideState, { status: 'ready' }>;
  alt: string;
}) {
  const { t } = useTranslation();
  const [decodeFailed, setDecodeFailed] = useState(false);

  if (decodeFailed) {
    return <div className="text-xs text-foreground-passive">{t('diff.image.decodeFailed')}</div>;
  }

  return (
    <img
      key={state.dataUrl}
      src={state.dataUrl}
      alt={alt}
      className="max-h-full max-w-full object-contain"
      onError={() => setDecodeFailed(true)}
    />
  );
}

export const ImageDiffView = observer(function ImageDiffView({
  projectId,
  workspaceId,
  activeFile,
}: ImageDiffViewProps) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;

  const fileKey = `${activeFile.path}|${activeFile.group}|${gitRefToString(activeFile.originalRef)}|${activeFile.modifiedRef ? gitRefToString(activeFile.modifiedRef) : ''}`;

  // For disk/staged groups the bytes can change without fileKey changing
  // (in-place overwrite, re-stage). Pinning to lastUpdatedAt reruns the
  // load whenever GitStore observes an fs-watch or index event.
  const reactiveRevision =
    activeFile.group === 'disk' || activeFile.group === 'staged' ? git.fullStatus.lastUpdatedAt : 0;

  const placeholder: SideState = { status: 'loading' };

  const originalQuery = useQuery({
    queryKey: ['image-diff', 'original', projectId, workspaceId, fileKey, reactiveRevision],
    queryFn: () => loadOriginal(projectId, workspaceId, activeFile),
    placeholderData: placeholder,
    staleTime: Infinity,
  });

  const modifiedQuery = useQuery({
    queryKey: ['image-diff', 'modified', projectId, workspaceId, fileKey, reactiveRevision],
    queryFn: () => loadModifiedWithTransientRetry(projectId, workspaceId, activeFile),
    placeholderData: placeholder,
    staleTime: Infinity,
  });

  const original = originalQuery.data ?? placeholder;
  const modified = modifiedQuery.data ?? placeholder;

  return (
    <div className="flex h-full min-h-0 w-full">
      <ImageSidePanel label={t('diff.image.original')} state={original} side="original" />
      <div className="w-px shrink-0 bg-border" />
      <ImageSidePanel label={t('diff.image.modified')} state={modified} side="modified" />
    </div>
  );
});
