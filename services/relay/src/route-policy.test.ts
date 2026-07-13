import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { resolveForwardableMobileRoute, RoutePolicyError } from './route-policy.js';

function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

describe('resolveForwardableMobileRoute', () => {
  it.each([
    ['GET', '/v1/devices/desktop-1/v1/snapshot', '/v1/snapshot', false],
    ['POST', '/v1/devices/desktop-1/v1/demands', '/v1/demands', false],
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
      'POST',
      '/v1/devices/desktop-1/v1/projects/p/tasks/t/sessions/session/input',
      '/v1/projects/p/tasks/t/sessions/session/input',
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
    ['GET', '/v1/devices/desktop-1/v1/snapshot?admin=true'],
    ['GET', '/v1/devices/desktop-1/v1/projects/a%2Fb/tasks/t/sessions'],
  ])('rejects %s %s', (method, url) => {
    expect(() => resolveForwardableMobileRoute(request(method, url))).toThrow(RoutePolicyError);
  });
});
