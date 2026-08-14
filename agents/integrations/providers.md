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
  `ZENMUX_API_KEY` or `LOVSTUDIO_LLM_API_KEY`. For Yoda-launched sessions, Yoda
  keeps the actual key in its encrypted secret store and passes it only through
  the child process environment; never put it in CLI arguments or logs.
- Codex-native model ids stay native for direct providers. At the ZenMux
  boundary, Yoda restores the catalog namespace (for example,
  `gpt-5.6-sol` -> `openai/gpt-5.6-sol`) for both Yoda-launched sessions and
  persistent external-Client sync, then removes that prefix when the route is
  restored to native Codex.
- By default, Yoda passes invocation-scoped provider overrides and the Profile
  key only to the child process it launches. MaaS exposes one global
  external-Agent sync policy; when enabled, activating or switching a Profile
  updates every supported Agent Client adapter. Codex CLI/App and Claude Code
  have persistent configuration adapters with snapshot-backed rollback.
- Global external-Agent sync is explicitly consented and visible in MaaS
  settings. Codex writes the active provider and `experimental_bearer_token` to
  the user-level `config.toml`; Claude Code writes `ANTHROPIC_BASE_URL` and
  `ANTHROPIC_AUTH_TOKEN` to the user-level `settings.json`. Both files use mode
  `0600`, and cleanup restores the original managed fields without replacing
  unrelated user configuration. The UI must disclose that these tokens are
  plaintext and persistent.
- Persistent sync requires the current global `externalAgentSyncVersion = 3`
  consent. Earlier versions represented narrower sync contracts and must not
  silently authorize the additional plaintext configuration target. New
  installations default to Yoda-only scope.
- `codex-maas-user-environment.ts` remains only for restoring or removing old
  managed environment state, including `YODA_MAAS_API_KEY`, during snapshot
  migration. Current Profiles must not publish credentials through it.
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
