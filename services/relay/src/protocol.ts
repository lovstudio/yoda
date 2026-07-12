export const RELAY_PROTOCOL_VERSION = 1 as const;

export type RelayRequestStartFrame = {
  v: typeof RELAY_PROTOCOL_VERSION;
  type: 'request.start';
  requestId: string;
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type RelayRequestCancelFrame = {
  v: typeof RELAY_PROTOCOL_VERSION;
  type: 'request.cancel';
  requestId: string;
  reason: 'client-disconnected' | 'timeout' | 'backpressure' | 'relay-shutdown';
};

export type RelayOutboundFrame = RelayRequestStartFrame | RelayRequestCancelFrame;

export type HostResponseStartFrame = {
  v: typeof RELAY_PROTOCOL_VERSION;
  type: 'response.start';
  requestId: string;
  status: number;
  headers: Record<string, string>;
};

export type HostResponseChunkFrame = {
  v: typeof RELAY_PROTOCOL_VERSION;
  type: 'response.chunk';
  requestId: string;
  sequence: number;
  bodyBase64: string;
};

export type HostResponseEndFrame = {
  v: typeof RELAY_PROTOCOL_VERSION;
  type: 'response.end';
  requestId: string;
};

export type HostResponseErrorFrame = {
  v: typeof RELAY_PROTOCOL_VERSION;
  type: 'response.error';
  requestId: string;
  code: string;
  message: string;
};

export type HostInboundFrame =
  | HostResponseStartFrame
  | HostResponseChunkFrame
  | HostResponseEndFrame
  | HostResponseErrorFrame;

export class ProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function isSafeToken(value: unknown, maxLength = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function parseHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new ProtocolError('Frame headers must be an object.');
  const result: Record<string, string> = {};
  const entries = Object.entries(value);
  if (entries.length > 32) throw new ProtocolError('Frame has too many headers.');
  for (const [name, headerValue] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name)) {
      throw new ProtocolError('Frame contains an invalid header name.');
    }
    if (
      typeof headerValue !== 'string' ||
      headerValue.length > 8_192 ||
      /[\r\n\0]/.test(headerValue)
    ) {
      throw new ProtocolError('Frame contains an invalid header value.');
    }
    result[name] = headerValue;
  }
  return result;
}

export function decodeBase64(value: string, maxBytes: number): Buffer {
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new ProtocolError('Frame body exceeds the configured limit.');
  }
  if (value && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ProtocolError('Frame body is not valid base64.');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length > maxBytes) throw new ProtocolError('Frame body exceeds the configured limit.');
  return buffer;
}

export function parseHostInboundFrame(raw: string, maxChunkBytes: number): HostInboundFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolError('Host frame must be valid JSON.');
  }
  if (!isRecord(value)) throw new ProtocolError('Host frame must be an object.');
  if (value.v !== RELAY_PROTOCOL_VERSION) {
    throw new ProtocolError('Host frame uses an unsupported protocol version.');
  }
  if (!isRequestId(value.requestId)) throw new ProtocolError('Host frame requestId is invalid.');

  switch (value.type) {
    case 'response.start': {
      if (
        !Number.isInteger(value.status) ||
        Number(value.status) < 100 ||
        Number(value.status) > 599
      ) {
        throw new ProtocolError('Host response status is invalid.');
      }
      return {
        v: RELAY_PROTOCOL_VERSION,
        type: 'response.start',
        requestId: value.requestId,
        status: Number(value.status),
        headers: parseHeaders(value.headers),
      };
    }
    case 'response.chunk': {
      if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) {
        throw new ProtocolError('Host response sequence is invalid.');
      }
      if (typeof value.bodyBase64 !== 'string') {
        throw new ProtocolError('Host response chunk is missing bodyBase64.');
      }
      decodeBase64(value.bodyBase64, maxChunkBytes);
      return {
        v: RELAY_PROTOCOL_VERSION,
        type: 'response.chunk',
        requestId: value.requestId,
        sequence: Number(value.sequence),
        bodyBase64: value.bodyBase64,
      };
    }
    case 'response.end':
      return {
        v: RELAY_PROTOCOL_VERSION,
        type: 'response.end',
        requestId: value.requestId,
      };
    case 'response.error': {
      if (
        !isSafeToken(value.code) ||
        typeof value.message !== 'string' ||
        value.message.length > 512
      ) {
        throw new ProtocolError('Host response error is invalid.');
      }
      return {
        v: RELAY_PROTOCOL_VERSION,
        type: 'response.error',
        requestId: value.requestId,
        code: value.code,
        message: value.message,
      };
    }
    default:
      throw new ProtocolError('Host frame type is unsupported.');
  }
}

export function encodeRelayFrame(frame: RelayOutboundFrame): string {
  return JSON.stringify(frame);
}
