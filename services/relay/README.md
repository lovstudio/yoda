# Yoda Relay

Yoda Relay exposes the existing Yoda Mobile HTTP/SSE API without opening an inbound port on the
desktop. A desktop host authenticates to Relay and owns one outbound WebSocket. Mobile requests are
authorized through LovStudio, converted into bounded frames, sent to that host, and streamed back
without persisting task content.

## Public endpoints

- `GET /health`
- `GET /v1/host/:deviceId` with WebSocket upgrade and `Authorization: Bearer <hostToken>`
- `POST /v1/pair` with `{ "deviceId": "...", "pairingCode": "..." }`
- `/v1/devices/:deviceId/v1/*` for the explicit Yoda Mobile route allowlist

The pairing response contains a mobile base URL such as
`https://relay.example/v1/devices/<deviceId>` and a device-scoped token. The existing mobile client
can append `/v1/snapshot`, session paths, and SSE paths to that base URL.

## LovStudio internal contract

Relay authenticates to both endpoints with `Authorization: Bearer <LOVSTUDIO_RELAY_SERVICE_TOKEN>`.

`POST $LOVSTUDIO_RELAY_AUTHORIZE_PATH`:

```json
{
  "kind": "host",
  "token": "device credential",
  "deviceId": "desktop device id"
}
```

The `kind` is either `host` or `mobile`. Success must return:

```json
{
  "authorized": true,
  "accountId": "LovStudio user id",
  "deviceId": "desktop device id",
  "credentialId": "optional credential id",
  "entitlementExpiresAt": "optional ISO timestamp"
}
```

`POST $LOVSTUDIO_RELAY_PAIR_PATH`:

```json
{ "deviceId": "desktop device id", "pairingCode": "one-time code" }
```

Success must return:

```json
{
  "deviceId": "desktop device id",
  "mobileToken": "device-scoped credential",
  "expiresAt": "optional ISO timestamp"
}
```

LovStudio remains authoritative for entitlement, expiry, revocation, and pairing-code consumption.
Relay does not cache successful authorization in the first release, so revocation is observed on
the next HTTP/SSE connection.

## Host frames

Relay to host:

- `request.start`: `{ v, type, requestId, method, path, headers, bodyBase64? }`
- `request.cancel`: `{ v, type, requestId, reason }`

Host to Relay:

- `response.start`: `{ v, type, requestId, status, headers }`
- `response.chunk`: `{ v, type, requestId, sequence, bodyBase64 }`
- `response.end`: `{ v, type, requestId }`
- `response.error`: `{ v, type, requestId, code, message }`

Protocol version is `1`. Chunk sequences start at `0`. Relay strips caller authorization, cookies,
hop-by-hop headers, and host-provided CORS headers. A decoded response chunk must be no larger than
half `YODA_RELAY_MAX_FRAME_BYTES` so its base64 JSON envelope stays within the WebSocket limit. POST
requests are never retried.

## Configuration

Required:

- `LOVSTUDIO_RELAY_SERVICE_TOKEN` — the same secret configured as
  `YODA_RELAY_SERVICE_SECRET` on LovStudio Web

Common optional values:

- `YODA_RELAY_HOST` — defaults to `0.0.0.0`
- `YODA_RELAY_PORT` — defaults to `8787`
- `YODA_RELAY_PUBLIC_BASE_URL` — defaults to `http://localhost:8787`
- `LOVSTUDIO_BASE_URL` — defaults to `https://lovstudio.ai`
- `LOVSTUDIO_RELAY_AUTHORIZE_PATH`
- `LOVSTUDIO_RELAY_PAIR_PATH`
- `YODA_RELAY_CORS_ALLOWED_ORIGINS` — comma-separated exact origins; empty disables browser CORS
- `YODA_RELAY_MAX_REQUEST_BODY_BYTES` — defaults to `131072`
- `YODA_RELAY_MAX_RESPONSE_BYTES` — defaults to `2097152` for non-SSE responses
- `YODA_RELAY_MAX_CONCURRENT_REQUESTS` — defaults to `32` per desktop
- `YODA_RELAY_MAX_CONCURRENT_STREAMS` — defaults to `8` per desktop
- `YODA_RELAY_REQUEST_TIMEOUT_MS` — defaults to `30000`
- `YODA_RELAY_STREAM_IDLE_TIMEOUT_MS` — defaults to `45000`
- `YODA_RELAY_HOST_REAUTHORIZE_INTERVAL_MS` — defaults to `60000`; refreshes online state and
  enforces host revocation/pass expiry

## Local commands

```bash
pnpm --filter @yoda/relay typecheck
pnpm --filter @yoda/relay test
pnpm --filter @yoda/relay build
LOVSTUDIO_RELAY_SERVICE_TOKEN=dev-secret pnpm --filter @yoda/relay dev
```

Build the production image from the repository root:

```bash
docker build -f services/relay/Dockerfile -t yoda-relay .
docker run --rm --env-file services/relay/.env -p 8787:8787 yoda-relay
```

Terminate TLS at the container platform or load balancer and set
`YODA_RELAY_PUBLIC_BASE_URL` to that public HTTPS origin. LovStudio Web also needs
`YODA_RELAY_PUBLIC_URL` set to the same origin.

## Production deployment constraints

- Run one Relay replica for the first release. Host connections live in process memory, so a
  multi-replica deployment needs consistent device routing or a shared connection router before it
  can safely scale horizontally.
- Configure edge/WAF rate limits for the host upgrade endpoint, `/v1/pair`, and device request
  routes. The service enforces body, frame, timeout, stream, and per-device concurrency limits, but
  it deliberately does not implement a distributed request-rate limiter.
- Use a public HTTPS origin with WebSocket support, health checks on `/health`, automatic restart,
  and no request buffering for SSE responses.
- Keep `LOVSTUDIO_RELAY_SERVICE_TOKEN` and LovStudio Web's `YODA_RELAY_SERVICE_SECRET` identical,
  secret, and outside the image. Rotate both together.
- Point the Yoda mobile build's `EXPO_PUBLIC_YODA_RELAY_ORIGIN` to the same origin. Production EAS
  builds pin `https://relay.yoda.lovstudio.ai`; the mobile app rejects pairing responses from any
  other origin.
