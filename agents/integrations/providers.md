# Providers

## Terminology

- **Agent Client/runtime**: Claude Code, Codex, Gemini CLI, Kimi CLI, and other
  executables Yoda launches. Their registry is `src/shared/agent-provider-registry.ts`.
- **Model provider/vendor**: OpenAI, Anthropic, Kimi, Google, and other companies
  that publish models. Their catalog is `src/shared/model-provider-catalog.ts`.
- Do not use the Agent Client/runtime registry to build model-provider settings.

## Source Of Truth

- `src/shared/agent-provider-registry.ts`
- `src/main/core/dependencies/dependency-manager.ts`
- `src/main/core/pty/`

## Current Providers (29)

codex, claude, devin, qwen, droid, gemini, cursor, copilot, amp, opencode, hermes, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, continue, codebuff, mistral, jules, junie, pi, letta, autohand, antigravity, grok

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
- Codex MaaS providers point at the loopback endpoint exposed by the optional
  `lovstudio.maas-gateway` Marketplace extension. Codex receives only a local
  admission token through `experimental_bearer_token`; the upstream endpoint
  and API key are delivered to the utility-process Gateway over IPC.
- Keep `codex-maas-user-environment.ts` until all v3 snapshots have migrated.
  It restores or removes the old `YODA_MAAS_API_KEY` login-session value, but
  the new Gateway path must never publish an upstream credential to the process
  environment.
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

1. update `src/shared/agent-provider-registry.ts`
2. update allowlisted agent env vars in `src/main/core/pty/pty-env.ts` if needed
3. add an agent event classifier in `src/main/core/conversations/impl/agent-event-classifiers/`
4. validate detection behavior in `src/main/core/dependencies/`
5. add or update tests for any non-standard behavior
