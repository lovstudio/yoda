import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { Ssh2PtySession } from './ssh2-pty';

function createSession(): { channel: EventEmitter; session: Ssh2PtySession } {
  const channel = new EventEmitter();
  const session = new Ssh2PtySession('ssh-session', channel as unknown as ClientChannel);
  return { channel, session };
}

function collectData(session: Ssh2PtySession): string[] {
  const received: string[] = [];
  session.onData((data) => received.push(data));
  return received;
}

describe('Ssh2PtySession.onData', () => {
  it('preserves Chinese and emoji across every possible byte split', () => {
    const text = 'prefix 中文与 emoji 😀🚀 suffix';
    const encoded = Buffer.from(text, 'utf8');

    for (let split = 1; split < encoded.length; split += 1) {
      const { channel, session } = createSession();
      const received = collectData(session);

      channel.emit('data', encoded.subarray(0, split));
      channel.emit('data', encoded.subarray(split));
      channel.emit('end');

      expect(received.join(''), `split at byte ${split}`).toBe(text);
    }
  });

  it('preserves Chinese and emoji when every byte arrives separately', () => {
    const text = '逐字节：中文 😀🧪';
    const encoded = Buffer.from(text, 'utf8');
    const { channel, session } = createSession();
    const received = collectData(session);

    for (const byte of encoded) {
      channel.emit('data', Buffer.from([byte]));
    }
    channel.emit('end');

    expect(received.join('')).toBe(text);
    expect(received.join('')).not.toContain('\uFFFD');
  });

  it('flushes an incomplete trailing sequence when the stream ends', () => {
    const encoded = Buffer.from('中', 'utf8');
    const { channel, session } = createSession();
    const received = collectData(session);

    channel.emit('data', encoded.subarray(0, encoded.length - 1));
    expect(received).toEqual([]);

    channel.emit('end');

    expect(received).toEqual(['\uFFFD']);
  });

  it('flushes only once when close follows end', () => {
    const encoded = Buffer.from('😀', 'utf8');
    const { channel, session } = createSession();
    const received = collectData(session);

    channel.emit('data', encoded.subarray(0, encoded.length - 1));
    channel.emit('end');
    channel.emit('close');

    expect(received).toEqual(['\uFFFD']);
  });
});
