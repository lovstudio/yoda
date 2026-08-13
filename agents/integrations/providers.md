# Providers

## Terminology

- **Agent Client/runtime**: Claude Code, Codex, Cohub, Gemini CLI, Kimi CLI, and other
  executables Yoda launches. Their registry is `src/shared/runtime-registry.ts`.
- **Model provider/vendor**: OpenAI, Anthropic, Kimi, Google, and other companies
  that publish models. Their catalog is `src/shared/model-provider-catalog.ts`.
- Do not use the Agent Client/runtime registry to build model-provider settings.

## Source Of Truth

- `src/shared/runtime-registry.ts`
- `src/main/core/dependencies/dependency-manager.ts`
- `src/main/core/pty/`

## Current Providers (30)

codex, claude, cohub, devin, qwen, droid, gemini, cursor, copilot, amp, opencode, hermes, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, continue, codebuff, mistral, jules, junie, pi, letta, autohand, antigravity, grok

## Provider Metadata Includes

- CLI and detection commands
- version args
- install command and docs URL
- auto-approve flags
- initial prompt handling
- keystroke injection behavior
- resume and session flags
- optional plan activation and auto-start commands
- optional runtime-native update commands used by the embedded workspace CLI

Runtime status cards combine dependency probes with `runtimeSettings.getRuntimeSnapshot(...)`;
keep config/model/update detection in that main-process service rather than reading user config files
directly from renderer components.

## Agent Event Classifiers

Each provider has a terminal output classifier in `src/main/core/conversations/impl/agent-event-classifiers/`. These parse agent terminal output to detect events (task completion, errors, etc.) and forward them to the renderer via the agent hooks module (`src/main/core/agent-hooks/`).

## Provider Runtime Notes

- Claude uses deterministic `--session-id` values for conversation isolation.
- Codex Plan sessions combine the read-only/no-approval CLI policy with native TUI `/plan`.
  `buildAgentCommand(...)` returns that mode switch as `startupInput`; local and SSH providers
  must inject it only after the TUI is ready, before accepting later turns.
- Codex MaaS providers point at the Base URL saved in each MaaS Profile. That
  target can be a remote service or a user-selected local gateway; the optional
  `lovstudio.maas-gateway` Marketplace extension is not a MaaS prerequisite.
- Every MaaS Profile owns its provider environment key, such as
  `ZENMUX_API_KEY` or `LOVSTUDIO_LLM_API_KEY`. Yoda keeps the actual key in its
  encrypted secret store; never write the key itself to `config.toml` or CLI
  arguments.
- Codex-native model ids stay native for direct providers. At the ZenMux
  boundary, Yoda restores the catalog namespace (for example,
  `gpt-5.6-sol` -> `openai/gpt-5.6-sol`) for both Yoda-launched sessions and
  persistent external-Client sync, then removes that prefix when the route is
  restored to native Codex.
- By default, Yoda passes invocation-scoped Codex provider overrides and the
  Profile key only to the child process it launches. MaaS exposes one global
  external-Agent sync policy; when enabled, activating or switching a Profile
  updates every supported Agent Client adapter. Codex CLI/App is the first
  persistent adapter. Other Clients must remain visibly marked as planned until
  their full configuration migration and rollback flows are implemented.
- Global external-Agent sync is explicitly consented and visible in MaaS settings. Yoda keeps
  a restorable snapshot and offers an immediate cleanup action. On macOS it
  stores an explicitly consented copy in Keychain and installs a secret-free
  LaunchAgent so external Codex instances keep working after Yoda quits or the
  user logs in again. The UI must explain that this is persistent and should
  be cleared before Yoda is disabled or uninstalled. Cleanup restores the
  original Codex config and login-session environment and removes both the
  Keychain item and LaunchAgent. Already-running Clients retain the environment
  inherited when they launched.
- Persistent sync requires the current global `externalAgentSyncVersion`
  consent. Older per-Profile `syncToAgentClientVersion` consent may be read once
  for compatibility, but the next global toggle migrates it into the MaaS-level
  setting and removes the legacy flags. New installations default to Yoda-only
  scope.
- `codex-maas-user-environment.ts` also restores or removes the old
  `YODA_MAAS_API_KEY` login-session value during v3 snapshot migration; current
  Profiles must not reuse that legacy variable.
- Never store a third-party MaaS key in Codex `auth.json`. That file belongs to
  the user's native OpenAI/ChatGPT login.
- `tasks.autoTrustWorktrees` applies to both Claude Code and Codex. Before launch,
  Yoda records the exact task directory in Claude's trust store or the active
  `CODEX_HOME/config.toml`; Codex receives a
  `[projects."<absolute path>"] trust_level = "trusted"` entry without replacing
  unrelated config.
- Agents with no CLI prompt flag (e.g., Amp, OpenCode) use keystroke injection — Yoda types the prompt into the TUI after startup.
- `src/main/core/agent-hooks/service.ts` forwards hook events to renderer windows and can show OS notifications. Also writes hook config files (`.claude/settings.local.json`, `.codex/config.toml`) into worktrees.

## Adding Or Changing A Provider

1. update `src/shared/runtime-registry.ts`
2. update allowlisted agent env vars in `src/main/core/pty/pty-env.ts` if needed
3. add an agent event classifier in `src/main/core/conversations/impl/agent-event-classifiers/`
4. validate detection behavior in `src/main/core/dependencies/`
5. add or update tests for any non-standard behavior
