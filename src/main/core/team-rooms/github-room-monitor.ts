import { eq } from 'drizzle-orm';
import { teamRoomUpdatedChannel } from '@shared/events/teamRoomEvents';
import { parseGitHubRepository, type GitHubRepositoryRef } from '@shared/github-repository';
import type { GitHubRoomMonitorState } from '@shared/team-communication';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import { db } from '@main/db/client';
import { projectRemotes } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { roomConductor } from './conductor';
import { shouldPublishGitHubUpdate, type WatchedGitHubResource } from './github-room-monitor-state';
import { getAllRooms, getRoom, postMessage } from './store';

const GITHUB_ROOM_POLL_MS = 60_000;

function disabledState(roomId: string): GitHubRoomMonitorState {
  return {
    roomId,
    state: 'disabled',
    repository: null,
    issueUpdatedAt: null,
    pullRequestUpdatedAt: null,
    lastCheckedAt: null,
    nextPollAt: null,
    lastError: null,
  };
}

class GitHubRoomMonitor {
  private initialized = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private states = new Map<string, GitHubRoomMonitorState>();
  private resources = new Map<string, WatchedGitHubResource>();
  private scans = new Map<string, Promise<GitHubRoomMonitorState>>();
  private off: (() => void) | null = null;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.off = events.on(teamRoomUpdatedChannel, ({ roomId }) => {
      void this.reconcile(roomId, true);
    });
    void getAllRooms()
      .then((rooms) => Promise.all(rooms.map((room) => this.reconcile(room.id, true))))
      .catch((error: unknown) => {
        log.warn('GitHubRoomMonitor: initial reconciliation failed', { error: String(error) });
      });
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.initialized = false;
  }

  async getState(roomId: string): Promise<GitHubRoomMonitorState> {
    const snapshot = await getRoom(roomId);
    if (
      !snapshot ||
      snapshot.room.status !== 'active' ||
      snapshot.room.communication.mode !== 'github'
    ) {
      const state = disabledState(roomId);
      this.states.set(roomId, state);
      return state;
    }
    return this.states.get(roomId) ?? this.runNow(roomId);
  }

  runNow(roomId: string): Promise<GitHubRoomMonitorState> {
    const existing = this.scans.get(roomId);
    if (existing) return existing;
    this.clearTimer(roomId);
    const scan = this.scan(roomId).finally(() => this.scans.delete(roomId));
    this.scans.set(roomId, scan);
    return scan;
  }

  private async reconcile(roomId: string, runImmediately: boolean): Promise<void> {
    const snapshot = await getRoom(roomId);
    if (
      !snapshot ||
      snapshot.room.status !== 'active' ||
      snapshot.room.communication.mode !== 'github'
    ) {
      this.clearTimer(roomId);
      this.states.set(roomId, disabledState(roomId));
      return;
    }
    if (runImmediately) {
      const alreadyScanning = this.scans.has(roomId);
      await this.runNow(roomId);
      if (alreadyScanning) await this.runNow(roomId);
    } else this.schedule(roomId);
  }

  private async scan(roomId: string): Promise<GitHubRoomMonitorState> {
    const snapshot = await getRoom(roomId);
    if (
      !snapshot ||
      snapshot.room.status !== 'active' ||
      snapshot.room.communication.mode !== 'github'
    ) {
      return disabledState(roomId);
    }
    const previous = this.states.get(roomId) ?? disabledState(roomId);
    const polling: GitHubRoomMonitorState = {
      ...previous,
      roomId,
      state: 'polling',
      lastError: null,
      nextPollAt: null,
    };
    this.states.set(roomId, polling);

    try {
      const repository = await this.resolveRepository(
        snapshot.room.projectId,
        snapshot.room.communication.githubRepository
      );
      if (!repository) throw new Error('No GitHub repository is configured for this room.');

      const issue = snapshot.room.communication.githubIssueNumber
        ? await this.readResource(
            `${roomId}:${repository.nameWithOwner}:issue:${snapshot.room.communication.githubIssueNumber}`,
            repository,
            'issue',
            snapshot.room.communication.githubIssueNumber
          )
        : null;
      const pullRequest = snapshot.room.communication.githubPullRequestNumber
        ? await this.readResource(
            `${roomId}:${repository.nameWithOwner}:pull:${snapshot.room.communication.githubPullRequestNumber}`,
            repository,
            'pull',
            snapshot.room.communication.githubPullRequestNumber
          )
        : null;

      const changed = shouldPublishGitHubUpdate(previous, issue, pullRequest);
      const checkedAt = new Date().toISOString();
      const next: GitHubRoomMonitorState = {
        roomId,
        state: 'idle',
        repository: repository.nameWithOwner,
        issueUpdatedAt: issue?.updatedAt ?? null,
        pullRequestUpdatedAt: pullRequest?.updatedAt ?? null,
        lastCheckedAt: checkedAt,
        nextPollAt: new Date(Date.now() + GITHUB_ROOM_POLL_MS).toISOString(),
        lastError: null,
      };
      this.states.set(roomId, next);

      if (changed) {
        await this.publishUpdate(snapshot, repository);
      }
      this.schedule(roomId);
      return next;
    } catch (error) {
      const failed: GitHubRoomMonitorState = {
        ...previous,
        roomId,
        state: 'error',
        lastCheckedAt: new Date().toISOString(),
        nextPollAt: new Date(Date.now() + GITHUB_ROOM_POLL_MS).toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      this.states.set(roomId, failed);
      this.schedule(roomId);
      log.warn('GitHubRoomMonitor: poll failed', { roomId, error: failed.lastError });
      return failed;
    }
  }

  private async readResource(
    key: string,
    repository: GitHubRepositoryRef,
    kind: 'issue' | 'pull',
    number: number
  ): Promise<WatchedGitHubResource> {
    const previous = this.resources.get(key) ?? { updatedAt: null, etag: null };
    const octokit = await getOctokit();
    const route =
      kind === 'issue'
        ? 'GET /repos/{owner}/{repo}/issues/{issue_number}'
        : 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
    try {
      const response = await octokit.request(route, {
        owner: repository.owner,
        repo: repository.repo,
        ...(kind === 'issue' ? { issue_number: number } : { pull_number: number }),
        headers: previous.etag ? { 'if-none-match': previous.etag } : undefined,
      });
      const data = response.data as { updated_at?: string | null };
      const next = {
        updatedAt: data.updated_at ?? previous.updatedAt,
        etag: response.headers.etag ?? previous.etag,
      };
      this.resources.set(key, next);
      return next;
    } catch (error) {
      if (isNotModified(error)) return previous;
      throw error;
    }
  }

  private async resolveRepository(
    projectId: string,
    configured: string
  ): Promise<GitHubRepositoryRef | null> {
    const explicit = parseGitHubRepository(configured);
    if (explicit) return explicit;
    const remotes = await db
      .select()
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, projectId));
    const remote = remotes.find((candidate) => candidate.remoteName === 'origin') ?? remotes[0];
    return parseGitHubRepository(remote?.remoteUrl);
  }

  private async publishUpdate(
    snapshot: NonNullable<Awaited<ReturnType<typeof getRoom>>>,
    repository: GitHubRepositoryRef
  ): Promise<void> {
    const leader = snapshot.members.find((member) => member.role === 'leader' && member.runtime);
    if (!leader) return;
    const refs = [
      snapshot.room.communication.githubIssueNumber
        ? `${repository.repositoryUrl}/issues/${snapshot.room.communication.githubIssueNumber}`
        : null,
      snapshot.room.communication.githubPullRequestNumber
        ? `${repository.repositoryUrl}/pull/${snapshot.room.communication.githubPullRequestNumber}`
        : null,
    ].filter((value): value is string => Boolean(value));
    const body = `GitHub coordination changed. Inspect ${refs.join(' and ')} and decide the next step.`;
    if (snapshot.room.communication.syncToRoom) {
      await postMessage({ roomId: snapshot.room.id, kind: 'system', body, mentions: [] });
    }
    await roomConductor.routeSignal({
      roomId: snapshot.room.id,
      authorMemberId: null,
      body,
      mentions: [leader.handle.toLowerCase()],
    });
  }

  private schedule(roomId: string): void {
    this.clearTimer(roomId);
    this.timers.set(
      roomId,
      setTimeout(() => void this.reconcile(roomId, true), GITHUB_ROOM_POLL_MS)
    );
  }

  private clearTimer(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
  }
}

function isNotModified(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: number }).status === 304
  );
}

export const githubRoomMonitor = new GitHubRoomMonitor();
