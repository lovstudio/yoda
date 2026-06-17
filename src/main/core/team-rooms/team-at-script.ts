import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makePtyId } from '@shared/ptyId';
import type { RuntimeId } from '@shared/runtime-registry';
import { resolveTask } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';

/**
 * Each room member gets its OWN copy of the team-* scripts under
 * `.yoda/<conversationId>/`, with its ptyId BAKED IN as a literal. We do NOT read
 * `$YODA_PTY_ID` from the environment: neither claude's Bash tool nor codex's
 * sandboxed shell reliably inherits the PTY env, so a baked literal is the only
 * robust way for the script to tell Yoda which member is calling. Port + token
 * are still read live from `~/.yoda/hook-endpoint.json` (they change across app
 * restarts; the conversation id does not).
 */
function buildScripts(ptyId: string): Record<'team-at' | 'team-status', string> {
  // Common prologue: resolve the live endpoint and bake this member's ptyId.
  const head = (name: string) => `#!/usr/bin/env bash
set -euo pipefail
ep="$HOME/.yoda/hook-endpoint.json"
if [ ! -f "$ep" ]; then echo "${name}: Yoda hook endpoint not found — is Yoda running?" >&2; exit 1; fi
port=$(sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p' "$ep")
token=$(sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' "$ep")
pty="${ptyId}"`;

  // Common epilogue: POST $body and surface the HTTP status on failure.
  const post = (
    name: string,
    eventType: string
  ) => `code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$port/hook" \\
  -H "X-Yoda-Token: $token" \\
  -H "X-Yoda-Pty-Id: $pty" \\
  -H "X-Yoda-Event-Type: ${eventType}" \\
  -H "Content-Type: application/json" \\
  -d "$body")
if [ "$code" != "200" ]; then echo "${name}: hook rejected (HTTP $code)" >&2; exit 1; fi`;

  // JSON-encode "$msg" into $esc (prefer python3; fall back to a naive quote).
  const escMsg = `esc=$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$msg")`;

  return {
    'team-at': `${head('team-at')}
# Usage: team-at <handle|all> <message...>
if [ "$#" -lt 2 ]; then echo "usage: team-at <handle|all> <message>" >&2; exit 2; fi
handle="$1"; shift
msg="$*"
if [ "$handle" = "all" ]; then to='"all"'; else to="[\\"$handle\\"]"; fi
${escMsg}
body="{\\"to\\": $to, \\"message\\": $esc}"
${post('team-at', 'team-at')}
echo "team-at: delivered to $handle"
`,
    'team-status': `${head('team-status')}
# Usage: team-status <message...>
if [ "$#" -lt 1 ]; then echo "usage: team-status <message>" >&2; exit 2; fi
msg="$*"
${escMsg}
body="{\\"message\\": $esc}"
${post('team-status', 'team-status')}
echo "team-status: shared"
`,
  };
}

/**
 * Write a member's `.yoda/<conversationId>/team-*` scripts (with its ptyId baked
 * in) into the task worktree and return the relative scripts directory to embed
 * in that member's prompt. Idempotent.
 */
export async function installTeamScripts(
  projectId: string,
  taskId: string,
  conversationId: string,
  runtime: RuntimeId
): Promise<string> {
  const relDir = join('.yoda', conversationId);
  const worktree = resolveTask(projectId, taskId)?.conversations.taskPath;
  if (!worktree) return relDir;
  try {
    const dir = join(worktree, relDir);
    await mkdir(dir, { recursive: true });
    const scripts = buildScripts(makePtyId(runtime, conversationId));
    await Promise.all([
      writeFile(join(dir, 'team-at'), scripts['team-at'], { mode: 0o755 }),
      writeFile(join(dir, 'team-status'), scripts['team-status'], { mode: 0o755 }),
    ]);
  } catch (error) {
    log.warn('installTeamScripts: failed', { projectId, taskId, error: String(error) });
  }
  return relDir;
}
