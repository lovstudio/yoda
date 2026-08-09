import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { resolveForwardableMobileRoute, RoutePolicyError } from './route-policy.js';

function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

describe('resolveForwardableMobileRoute', () => {
  it.each([
    ['GET', '/v1/devices/desktop-1/v1/snapshot', '/v1/snapshot', false],
    ['GET', '/v1/devices/desktop-1/v1/profile', '/v1/profile', false],
    ['GET', '/v1/devices/desktop-1/v1/configuration', '/v1/configuration', false],
    ['GET', '/v1/devices/desktop-1/v1/skills', '/v1/skills', false],
    [
      'GET',
      '/v1/devices/desktop-1/v1/projects/project%20one/skills',
      '/v1/projects/project%20one/skills',
      false,
    ],
    ['POST', '/v1/devices/desktop-1/v1/demands', '/v1/demands', false],
    [
      'POST',
      '/v1/devices/desktop-1/v1/projects/project/tasks/task/actions',
      '/v1/projects/project/tasks/task/actions',
      false,
    ],
    ['POST', '/v1/devices/desktop-1/v1/attachments', '/v1/attachments', false],
    ['POST', '/v1/devices/desktop-1/v1/xhs/jobs', '/v1/xhs/jobs', false],
    ['GET', '/v1/devices/desktop-1/v1/xhs/jobs/job-1', '/v1/xhs/jobs/job-1', false],
    [
      'POST',
      '/v1/devices/desktop-1/v1/xhs/jobs/job-1/confirm',
      '/v1/xhs/jobs/job-1/confirm',
      false,
    ],
    [
      'POST',
      '/v1/devices/desktop-1/v1/attachments/123e4567-e89b-12d3-a456-426614174000/chunks',
      '/v1/attachments/123e4567-e89b-12d3-a456-426614174000/chunks',
      false,
    ],
    [
      'GET',
      '/v1/devices/desktop-1/v1/projects/project%20one/tasks/task-1/sessions',
      '/v1/projects/project%20one/tasks/task-1/sessions',
      false,
    ],
    [
      'GET',
      '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/session/events',
      '/v1/projects/p/tasks/t/sessions/session/events',
      true,
    ],
    [
      'GET',
      '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/session/skills',
      '/v1/projects/p/tasks/t/sessions/session/skills',
      false,
    ],
    [
      'POST',
      '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/session/input',
      '/v1/projects/p/tasks/t/sessions/session/input',
      false,
    ],
    [
      'POST',
      '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/session/config',
      '/v1/projects/p/tasks/t/sessions/session/config',
      false,
    ],
  ])('allows %s %s', (method, url, upstreamPath, isEventStream) => {
    expect(resolveForwardableMobileRoute(request(method, url))).toEqual({
      deviceId: 'desktop-1',
      upstreamPath,
      isEventStream,
    });
  });

  it.each([
    ['DELETE', '/v1/devices/desktop-1/v1/snapshot'],
    ['GET', '/v1/devices/desktop-1/health'],
    ['GET', '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/s/input'],
    ['POST', '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/s/events'],
    ['POST', '/v1/devices/desktop-1/v1/skills'],
    ['GET', '/v1/devices/desktop-1/v1/xhs/jobs'],
    ['GET', '/v1/devices/desktop-1/v1/projects/p/tasks/t/actions'],
    ['POST', '/v1/devices/desktop-1/v1/xhs/jobs/job-1/raw'],
    ['POST', '/v1/devices/desktop-1/v1/projects/p/skills'],
    ['POST', '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/s/skills'],
    ['GET', '/v1/devices/desktop-1/v1/snapshot?admin=true'],
    ['GET', '/v1/devices/desktop-1/v1/projects/a%2Fb/tasks/t/sessions'],
  ])('rejects %s %s', (method, url) => {
    expect(() => resolveForwardableMobileRoute(request(method, url))).toThrow(RoutePolicyError);
  });
});
