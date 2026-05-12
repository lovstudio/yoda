<p align="center">
  <img src="docs/images/cover.png" alt="Yoda — Master agentic coding through parallel orchestration" width="100%">
</p>

<h1 align="center">Yoda</h1>

<p align="center">
  <strong>The Jedi‑master desktop for agentic coding.</strong><br>
  <sub>Run many coding agents in parallel — each in its own isolated git worktree, local or over SSH.</sub>
</p>

<div align="center">

[![Apache 2.0 License](https://img.shields.io/badge/License-Apache_2.0-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)
[![Downloads](https://img.shields.io/github/downloads/lovstudio/yoda/total?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda/releases)
[![GitHub Stars](https://img.shields.io/github/stars/lovstudio/yoda?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda)
[![Last Commit](https://img.shields.io/github/last-commit/lovstudio/yoda?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda/commits/main)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/lovstudio/yoda?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda/graphs/commit-activity)
<br>
[![Discord](https://img.shields.io/badge/Discord-join-%235462eb?labelColor=%235462eb&logo=discord&logoColor=%23f5f5f5)](https://discord.gg/f2fv7YxuR2)
[![Y Combinator W26](https://img.shields.io/badge/Y%20Combinator-W26-orange)](https://www.ycombinator.com)
[![Follow @lovstudio on X](https://img.shields.io/twitter/follow/lovstudio?logo=X&color=%23f5f5f5)](https://twitter.com/intent/follow?screen_name=lovstudio)

<br>

  <a href="https://lovstudio.ai/yoda/download">
    <img src="https://lovstudio.ai/yoda/media/readme/downloadforwindows.png" alt="Download for Windows" height="40">
  </a>
  <a href="https://lovstudio.ai/yoda/download">
    <img src="https://lovstudio.ai/yoda/media/readme/downloadformacos.png" alt="Download for macOS" height="40">
  </a>
  <a href="https://lovstudio.ai/yoda/download">
    <img src="https://lovstudio.ai/yoda/media/readme/downloadforlinux.png" alt="Download for Linux" height="40">
  </a>

<br><br>

[Highlights](#highlights) · [Why Yoda](#why-yoda) · [Installation](#installation) · [Providers](#providers) · [Architecture](#architecture) · [Contributing](#contributing) · [FAQ](#faq)

</div>

<br>

## Why Yoda

Modern coding agents are powerful — but managing more than one at a time devolves quickly: terminals multiply, branches collide, context evaporates. Yoda was built around a single discipline: **run many agents in parallel without losing the plot.**

Every task spawns an isolated **git worktree** (locally or over SSH), every agent stays sandboxed, every diff is reviewable side‑by‑side, and every merge is deliberate. Dispatch work, review, intervene, and merge with the calm precision of a master orchestrator — instead of the chaos of switching tabs.

Yoda is **provider‑agnostic**: Claude Code, Codex, OpenCode, Gemini, Amp, Cursor, Copilot, and 20+ more CLIs all run under the same orchestration model. It also pipes Linear / GitHub / Jira tickets straight into a session and surfaces CI/CD checks from the sidebar — so the loop from ticket → agent → review → ship lives in one window.

## Highlights

- **Parallel worktrees** — Each task runs in its own `git worktree`, isolated from your working tree. Multiple agents work simultaneously without stomping on each other.
- **Provider‑agnostic** — 24+ coding agent CLIs supported (Claude Code, Codex, OpenCode, Gemini, Amp, Cursor, Copilot, Cline, Goose, Kimi, Qwen, …). Switch providers per task, not per project.
- **Remote dev over SSH** — Add a remote machine, mount projects on it, and run agents there with the same workflow. Credentials live in your OS keychain.
- **Ticket → session** — Pull Linear / Jira / GitHub Issues / GitLab / Forgejo / Plain tickets straight into a new agent session as the prompt.
- **CI/CD aware** — Watch GitHub Actions / build status next to the diff. Re‑dispatch the agent without leaving the task.
- **Review & archive** — Mark tasks as needs‑review, run pre‑archive commands (e.g. cleanup scripts), then archive with one keystroke.
- **MCP built‑in** — Configure Model Context Protocol servers per project, shared across all agents that support MCP.
- **Local‑first** — App state lives in a local SQLite DB. Yoda itself never phones home with your code; only the agent CLI you chose talks to its provider.
- **Cross‑platform** — Native Electron app for macOS (Apple Silicon + Intel), Windows, and Linux.

## Installation

### macOS
- Homebrew: `brew install --cask yoda`
- Apple Silicon: https://releases.lovstudio.ai/yoda/yoda-arm64.dmg
- Intel x64: https://releases.lovstudio.ai/yoda/yoda-x64.dmg

### Windows
- Installer (x64): https://releases.lovstudio.ai/yoda/yoda-x64.msi
- Portable (x64): https://releases.lovstudio.ai/yoda/yoda-x64.exe

### Linux
- AppImage (x64): https://releases.lovstudio.ai/yoda/yoda-x86_64.AppImage
- Debian package (x64): https://releases.lovstudio.ai/yoda/yoda-amd64.deb

**[All releases (macOS · Windows · Linux)](https://github.com/lovstudio/yoda/releases/latest)** · [Changelog](./CHANGELOG.md)

## Remote Development over SSH

Connect to remote machines via SSH/SFTP to work with remote codebases without leaving Yoda. Use SSH agent or key authentication; credentials are stored in your OS keychain. Run any supported coding agent on remote projects with the same parallel worktree workflow as local development.

See [Remote Projects](https://lovstudio.ai/yoda/docs/remote-projects) and [Bring Your Own Infrastructure](https://lovstudio.ai/yoda/docs/bring-your-own-infrastructure) for setup details.

## Providers

### Coding agents (24+)

Yoda is provider‑agnostic and built to add new CLIs quickly. If yours is missing, [open an issue](https://github.com/lovstudio/yoda/issues) or send a PR.

| Provider | Install |
| --- | --- |
| [Amp](https://ampcode.com/manual#install) | `npm install -g @sourcegraph/amp@latest` |
| [Auggie](https://docs.augmentcode.com/cli/overview) | `npm install -g @augmentcode/auggie` |
| [Autohand Code](https://autohand.ai/code/) | `npm install -g autohand-cli` |
| [Charm Crush](https://github.com/charmbracelet/crush) | `npm install -g @charmland/crush` |
| [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) | <code>curl -fsSL https://claude.ai/install.sh &#124; bash</code> |
| [Cline](https://docs.cline.bot/cline-cli/overview) | `npm install -g cline` |
| [Codebuff](https://www.codebuff.com/docs/help/quick-start) | `npm install -g codebuff` |
| [Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` |
| [Continue](https://docs.continue.dev/guides/cli) | `npm i -g @continuedev/cli` |
| [Cursor](https://cursor.com/cli) | <code>curl https://cursor.com/install -fsS &#124; bash</code> |
| [Devin](https://cli.devin.ai/docs) | <code>curl -fsSL https://cli.devin.ai/install.sh &#124; bash</code> |
| [Droid (Factory)](https://docs.factory.ai/cli/getting-started/quickstart) | <code>curl -fsSL https://app.factory.ai/cli &#124; sh</code> |
| [Gemini](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) | `npm install -g @github/copilot` |
| [Goose](https://block.github.io/goose/docs/quickstart/) | <code>curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh &#124; bash</code> |
| [Kilocode](https://kilo.ai/docs/cli) | `npm install -g @kilocode/cli` |
| [Kimi](https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html) | `uv tool install kimi-cli` |
| [Kiro (AWS)](https://kiro.dev/docs/cli/) | <code>curl -fsSL https://cli.kiro.dev/install &#124; bash</code> |
| [Letta](https://docs.letta.com/letta-code/cli) | `npm install -g @letta-ai/letta-code` |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | <code>curl -LsSf https://mistral.ai/vibe/install.sh &#124; bash</code> |
| [OpenCode](https://opencode.ai/docs/cli/) | `npm install -g opencode-ai` |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | `npm install -g @mariozechner/pi-coding-agent` |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | `npm install -g @qwen-code/qwen-code` |
| [Rovo Dev](https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/) | `acli rovodev auth login` |

### Issue trackers

Pass tickets, issues, and support threads straight to your coding agent.

| Tool | Auth |
| --- | --- |
| [Linear](https://linear.app) | Linear API key |
| [Jira](https://www.atlassian.com/software/jira) | Site URL + email + Atlassian API token |
| [GitHub Issues](https://docs.github.com/en/issues) | OAuth, or `gh auth login` |
| [GitLab Issues](https://docs.gitlab.com/user/project/issues/) | GitLab URL + PAT with `read_api` |
| [Forgejo Issues](https://forgejo.org/) | Forgejo URL + API token |
| [Plain Threads](https://www.plain.com/) | Plain API key |

## Architecture

Yoda is an Electron app split into three parts:

- **Main process** (`src/main/`) — Owns the SQLite store (Drizzle), PTY/session orchestration, git worktree management, SSH tunneling, and the provider registry. Exposes a typed RPC surface to the renderer.
- **Renderer** (`src/renderer/`) — React + MobX UI. Reads via React Query, writes via RPC, mounts agent terminals via `node‑pty` round‑trips. View and modal routing are explicit registries.
- **Shared** (`src/shared/`) — Types, IPC contracts, and the agent provider registry that both sides import from.

See [`AGENTS.md`](./AGENTS.md) and [`agents/`](./agents/) for the full topic map (architecture, workflows, risky areas, conventions).

## Contributing

Small, focused PRs over big bangs. See the [Contributing Guide](CONTRIBUTING.md) for setup, conventions, and how to add a new provider. Join the [Discord](https://discord.gg/f2fv7YxuR2) to discuss design choices and provider requests.

## FAQ

<details>
<summary><b>What telemetry do you collect and can I disable it?</b></summary>

> We send **anonymous, allow‑listed events** (app start/close, feature usage names, app/platform versions) to PostHog.
> We **do not** send code, file paths, repo names, prompts, or PII.
>
> **Disable telemetry:**
>
> - In the app: **Settings → General → Privacy & Telemetry** (toggle off)
> - Or via env var before launch: `TELEMETRY_ENABLED=false`
>
> Full details: see [Telemetry](https://lovstudio.ai/yoda/docs/telemetry).
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

> **App data is local‑first.** Yoda stores app state in a local SQLite database:
>
> ```
> macOS:   ~/Library/Application Support/yoda/yoda.db
> Windows: %APPDATA%\yoda\yoda.db
> Linux:   ~/.config/yoda/yoda.db
> ```
>
> **Privacy note:** Yoda itself stores data locally. **When you use a coding agent (Claude Code, Codex, Qwen, …), that agent's CLI sends your code and prompts to its own provider's cloud servers** for processing. Each provider has its own data‑handling and retention policy.
>
> You can reset the local DB by deleting the file (quit the app first). It is recreated on next launch.
</details>

<details>
<summary><b>How does Yoda isolate agents?</b></summary>

> Every task gets its own **git worktree** under a Yoda‑managed directory, separate from your main working tree. Agents only see the files inside their worktree, so simultaneous edits never collide. When you finish a task you can merge, cherry‑pick, or archive — your primary working tree is untouched until you decide.
</details>

<details>
<summary><b>How do I add a new provider?</b></summary>

> Yoda is **provider‑agnostic** and built to add CLIs quickly.
>
> - Open a PR following the [Contributing Guide](CONTRIBUTING.md).
> - Include: provider name, how it's invoked (CLI command), auth notes, and minimal setup steps.
> - The provider lives in `src/shared/agent-provider-registry.ts` plus an output classifier under `src/main/core/conversations/impl/agent-event-classifiers/`.
>
> If you're unsure where to start, open an issue with the CLI's link and typical commands.
</details>

<details>
<summary><b>What permissions does Yoda need?</b></summary>

> - **Filesystem / Git** — to read/write your repo and create git worktrees for isolation.
> - **Network** — only for the provider CLIs you choose to use and for optional GitHub actions.
> - **Local DB** — to store app state in SQLite on your machine.
>
> Yoda itself does **not** send your code or chats anywhere. Third‑party CLIs may, per their own policies.
</details>

<details>
<summary><b>Can I work with remote projects over SSH?</b></summary>

> **Yes.** Yoda supports remote development via SSH.
>
> **Setup:**
> 1. Go to **Settings → SSH Connections** and add your server details.
> 2. Choose authentication: SSH agent (recommended), private key, or password.
> 3. Add a remote project and specify the path on the server.
>
> **Requirements:**
> - SSH access to the remote server
> - Git installed on the remote server
> - For agent auth: SSH agent running with your key loaded (`ssh-add -l`)
>
> See [Remote Projects](https://lovstudio.ai/yoda/docs/remote-projects) and [Bring Your Own Infrastructure](https://lovstudio.ai/yoda/docs/bring-your-own-infrastructure) for details.
</details>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lovstudio/yoda&type=Date)](https://star-history.com/#lovstudio/yoda&Date)

## License

Apache‑2.0 © [LovStudio](https://lovstudio.ai). See [LICENSE.md](./LICENSE.md).

<br>

<p align="center">
  <a href="https://x.com/lovstudio"><img src="https://img.shields.io/twitter/follow/lovstudio?style=social&label=Follow%20%40lovstudio" alt="Follow @lovstudio"></a>
</p>
