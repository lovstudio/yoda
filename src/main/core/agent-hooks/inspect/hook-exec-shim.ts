/**
 * Wraps a hook command so that, when it runs, it tees its output and POSTs an
 * execution record back to Yoda's hook server (X-Yoda-Event-Type: hook-exec).
 *
 * The original command is base64-encoded and passed as an argument so we never
 * have to escape arbitrary shell inside shell. The shim is idempotent: a command
 * that already carries the SHIM_MARKER is returned unchanged, and unwrap() can
 * recover the original.
 */
const SHIM_MARKER = 'YODA_HOOK_SHIM_V1';

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function fromB64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

export function isShimmed(command: string): boolean {
  return command.includes(SHIM_MARKER);
}

export function unwrapShim(command: string): string {
  const match = command.match(/#__YODA_ORIG__:([A-Za-z0-9+/=]+)#/);
  if (!match) return command;
  try {
    return fromB64(match[1]);
  } catch {
    return command;
  }
}

/**
 * Build a POSIX-shell shim around `original`. `hookId` and `hookEvent` are
 * embedded so the exec record can be correlated to the inspected hook.
 *
 * Hook stdin (the JSON event payload Claude pipes in) is forwarded to the
 * original command and also captured so the original behaves identically.
 */
export function wrapHookCommand(original: string, hookId: string, hookEvent: string): string {
  if (isShimmed(original)) return original;

  const encOrig = b64(original);
  // Single-quoted POSIX strings; embedded single quotes escaped as '\''.
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

  // The shim:
  //  1. reads stdin once into a temp file (so we can both pipe it to the
  //     original command and forward it unchanged),
  //  2. runs the decoded original with that stdin, capturing combined output,
  //  3. POSTs a hook-exec record (best-effort, never fails the hook).
  const script = [
    `# ${SHIM_MARKER} #__YODA_ORIG__:${encOrig}#`,
    `__yoda_in="$(mktemp)"; cat > "$__yoda_in" 2>/dev/null || :`,
    `__yoda_orig="$(printf %s ${q(encOrig)} | base64 -d 2>/dev/null || printf %s ${q(encOrig)} | base64 --decode 2>/dev/null)"`,
    `__yoda_out="$(sh -c "$__yoda_orig" < "$__yoda_in" 2>&1)"; __yoda_rc=$?`,
    `printf %s "$__yoda_out"`,
    `if [ -n "$YODA_HOOK_PORT" ] && command -v curl >/dev/null 2>&1; then`,
    `  printf '{"hookId":%s,"hookEvent":%s,"exitCode":%s,"output":"%s"}' ` +
      `${q(JSON.stringify(hookId))} ${q(JSON.stringify(hookEvent))} "$__yoda_rc" ` +
      `"$(printf %s "$__yoda_out" | head -c 4000 | sed 's/[\\\\"]/ /g; s/[[:cntrl:]]/ /g')" | ` +
      `curl -sf -X POST -H "Content-Type: application/json" ` +
      `-H "X-Yoda-Token: $YODA_HOOK_TOKEN" -H "X-Yoda-Pty-Id: $YODA_PTY_ID" ` +
      `-H "X-Yoda-Event-Type: hook-exec" -d @- "http://127.0.0.1:$YODA_HOOK_PORT/hook" >/dev/null 2>&1 || :`,
    `fi`,
    `rm -f "$__yoda_in" 2>/dev/null || :`,
    `exit $__yoda_rc`,
  ].join('\n');

  return `sh -c ${q(script)}`;
}
