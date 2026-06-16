import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveTask } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';

/**
 * The bundled `team-at` script a room member runs to message a teammate/the lead.
 * It reads the hook server's live endpoint from ~/.yoda/hook-endpoint.json (which
 * survives app restarts) and the conversation correlation from $YODA_PTY_ID
 * (injected into the agent's PTY env), then POSTs a `team-at` event to /hook.
 */
const SCRIPT = `#!/usr/bin/env bash
# Yoda team-at: deliver a message to a teammate or the lead.
# Usage: .yoda/team-at <handle|all> <message...>
set -euo pipefail
if [ "$#" -lt 2 ]; then echo "usage: team-at <handle|all> <message>" >&2; exit 2; fi
ep="$HOME/.yoda/hook-endpoint.json"
if [ ! -f "$ep" ]; then echo "team-at: Yoda hook endpoint not found" >&2; exit 1; fi
port=$(sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p' "$ep")
token=$(sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' "$ep")
handle="$1"; shift
msg="$*"
if [ "$handle" = "all" ]; then to='"all"'; else to="[\\"$handle\\"]"; fi
# JSON-encode the message (prefer python3; fall back to a naive quote).
esc=$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$msg")
if [ -z "\${YODA_PTY_ID:-}" ]; then echo "team-at: $YODA_PTY_ID is empty in this shell — Yoda can't tell which agent is calling." >&2; exit 1; fi
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$port/hook" \\
  -H "X-Yoda-Token: $token" \\
  -H "X-Yoda-Pty-Id: $YODA_PTY_ID" \\
  -H "X-Yoda-Event-Type: team-at" \\
  -H "Content-Type: application/json" \\
  -d "{\\"to\\": $to, \\"message\\": $esc}")
if [ "$code" != "200" ]; then echo "team-at: hook rejected (HTTP $code, pty=$YODA_PTY_ID)" >&2; exit 1; fi
echo "team-at: delivered to $handle"
`;

/**
 * The bundled `team-status` script: broadcast a short progress update to the
 * room WITHOUT handing off the turn. It posts a display-only room message (no
 * @mentions, so the conductor never routes it) — the team's "standup" channel.
 */
const STATUS_SCRIPT = `#!/usr/bin/env bash
# Yoda team-status: share a short progress update with the room (no hand-off).
# Usage: .yoda/team-status <message...>
set -euo pipefail
if [ "$#" -lt 1 ]; then echo "usage: team-status <message>" >&2; exit 2; fi
ep="$HOME/.yoda/hook-endpoint.json"
if [ ! -f "$ep" ]; then echo "team-status: Yoda hook endpoint not found" >&2; exit 1; fi
port=$(sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p' "$ep")
token=$(sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' "$ep")
msg="$*"
esc=$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$msg")
if [ -z "\${YODA_PTY_ID:-}" ]; then echo "team-status: $YODA_PTY_ID is empty in this shell — Yoda can't tell which agent is calling." >&2; exit 1; fi
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$port/hook" \\
  -H "X-Yoda-Token: $token" \\
  -H "X-Yoda-Pty-Id: $YODA_PTY_ID" \\
  -H "X-Yoda-Event-Type: team-status" \\
  -H "Content-Type: application/json" \\
  -d "{\\"message\\": $esc}")
if [ "$code" != "200" ]; then echo "team-status: hook rejected (HTTP $code, pty=$YODA_PTY_ID)" >&2; exit 1; fi
echo "team-status: shared"
`;

/**
 * The bundled `team-verdict` script: record a structured PASS/FAIL verdict at the
 * end of a review turn. This is the reliable, explicit hand-off signal — the
 * conductor advances the review loop from this (no scraping the PTY for a marker).
 * The message is forwarded to the implementer (on fail) or shown to the lead (on
 * pass).
 */
const VERDICT_SCRIPT = `#!/usr/bin/env bash
# Yoda team-verdict: record your review verdict and hand off.
# Usage: .yoda/team-verdict <pass|fail> <message...>
set -euo pipefail
if [ "$#" -lt 1 ]; then echo "usage: team-verdict <pass|fail> <message>" >&2; exit 2; fi
verdict="$1"; shift
if [ "$verdict" != "pass" ] && [ "$verdict" != "fail" ]; then
  echo "team-verdict: first arg must be 'pass' or 'fail'" >&2; exit 2
fi
ep="$HOME/.yoda/hook-endpoint.json"
if [ ! -f "$ep" ]; then echo "team-verdict: Yoda hook endpoint not found" >&2; exit 1; fi
port=$(sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p' "$ep")
token=$(sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' "$ep")
msg="$*"
esc=$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$msg")
if [ -z "\${YODA_PTY_ID:-}" ]; then echo "team-verdict: $YODA_PTY_ID is empty in this shell — Yoda can't tell which agent is calling." >&2; exit 1; fi
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$port/hook" \\
  -H "X-Yoda-Token: $token" \\
  -H "X-Yoda-Pty-Id: $YODA_PTY_ID" \\
  -H "X-Yoda-Event-Type: team-verdict" \\
  -H "Content-Type: application/json" \\
  -d "{\\"verdict\\": \\"$verdict\\", \\"message\\": $esc}")
if [ "$code" != "200" ]; then echo "team-verdict: hook rejected (HTTP $code, pty=$YODA_PTY_ID)" >&2; exit 1; fi
echo "team-verdict: $verdict recorded"
`;

/** Idempotently write the `.yoda/team-*` scripts into a task's worktree. */
export async function installTeamAtScript(projectId: string, taskId: string): Promise<void> {
  const worktree = resolveTask(projectId, taskId)?.conversations.taskPath;
  if (!worktree) return;
  try {
    const dir = join(worktree, '.yoda');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'team-at'), SCRIPT, { mode: 0o755 });
    await writeFile(join(dir, 'team-status'), STATUS_SCRIPT, { mode: 0o755 });
    await writeFile(join(dir, 'team-verdict'), VERDICT_SCRIPT, { mode: 0o755 });
  } catch (error) {
    log.warn('installTeamAtScript: failed', { projectId, taskId, error: String(error) });
  }
}
