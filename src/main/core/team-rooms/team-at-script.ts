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
curl -sf -X POST "http://127.0.0.1:$port/hook" \\
  -H "X-Yoda-Token: $token" \\
  -H "X-Yoda-Pty-Id: \${YODA_PTY_ID:-}" \\
  -H "X-Yoda-Event-Type: team-at" \\
  -H "Content-Type: application/json" \\
  -d "{\\"to\\": $to, \\"message\\": $esc}" >/dev/null
echo "team-at: delivered to $handle"
`;

/** Idempotently write `.yoda/team-at` into a task's worktree. */
export async function installTeamAtScript(projectId: string, taskId: string): Promise<void> {
  const worktree = resolveTask(projectId, taskId)?.conversations.taskPath;
  if (!worktree) return;
  try {
    const dir = join(worktree, '.yoda');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'team-at'), SCRIPT, { mode: 0o755 });
  } catch (error) {
    log.warn('installTeamAtScript: failed', { projectId, taskId, error: String(error) });
  }
}
