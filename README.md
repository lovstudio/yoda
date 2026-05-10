<img alt="Yoda banner" src="https://github.com/user-attachments/assets/a2ecaf3c-9d84-40ca-9a8e-d4f612cc1c6f" />


<div align="center" style="margin:24px 0;">
  
<br />

[![Apache 2.0 License](https://img.shields.io/badge/License-Apache_2.0-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)
[![Downloads](https://img.shields.io/github/downloads/lovstudio/yoda/total?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda/releases)
[![GitHub Stars](https://img.shields.io/github/stars/lovstudio/yoda?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda)
[![Last Commit](https://img.shields.io/github/last-commit/lovstudio/yoda?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda/commits/main)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/lovstudio/yoda?labelColor=333333&color=666666)](https://github.com/lovstudio/yoda/graphs/commit-activity)
<br>
[![Discord](https://img.shields.io/badge/Discord-join-%235462eb?labelColor=%235462eb&logo=discord&logoColor=%23f5f5f5)](https://discord.gg/f2fv7YxuR2)
<a href="https://www.ycombinator.com"><img src="https://img.shields.io/badge/Y%20Combinator-W26-orange" alt="Y Combinator W26"></a>
[![Follow @lovstudio on X](https://img.shields.io/twitter/follow/lovstudio?logo=X&color=%23f5f5f5)](https://twitter.com/intent/follow?screen_name=lovstudio)

<br />

  <a href="https://lovstudio.ai/yoda/download" style="display:inline-block; margin-right:8px; text-decoration:none; outline:none; border:none;">
    <img src="https://lovstudio.ai/yoda/media/readme/downloadforwindows.png" alt="Download for Windows" height="40">
  </a>
  <a href="https://lovstudio.ai/yoda/download" style="display:inline-block; margin-right:8px; text-decoration:none; outline:none; border:none;">
    <img src="https://lovstudio.ai/yoda/media/readme/downloadformacos.png" alt="Download for macOS" height="40">
  </a>
  <a href="https://lovstudio.ai/yoda/download" style="display:inline-block; text-decoration:none; outline:none; border:none;">
    <img src="https://lovstudio.ai/yoda/media/readme/downloadforlinux.png" alt="Download for Linux" height="40">
  </a>

</div>

<br />

Yoda is the Jedi-master desktop for agentic coding — a provider-agnostic Agentic Development Environment (ADE) built around the discipline of running many coding agents in parallel without losing the plot. Each agent gets its own isolated git worktree, locally or over SSH, so you can dispatch work, review diffs, and merge with the calm precision of a master orchestrator instead of the chaos of switching tabs.

Yoda speaks 24 CLI agents (Claude Code, Codex, OpenCode, Gemini, Amp, …), routes Linear / GitHub / Jira tickets straight into a session, surfaces CI/CD checks, and turns parallel agent management from a juggling act into a craft.

**Develop on remote servers via SSH**

Connect to remote machines via SSH/SFTP to work with remote codebases. Yoda supports SSH agent and key authentication, with secure credential storage in your OS keychain. Run agents on remote projects using the same parallel workflow as local development. [Learn more](https://lovstudio.ai/yoda/cloud)

<div align="center" style="margin:24px 0;">

[Installation](#installation) • [Providers](#providers) • [Contributing](#contributing) • [FAQ](#faq)

</div>

<img alt="Yoda product" src="https://lovstudio.ai/yoda/media/blog/public-v1-beta/v1beta.jpg" />

# Installation

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

### Release Overview

**[Latest Releases (macOS • Windows • Linux)](https://github.com/lovstudio/yoda/releases/latest)**

# Providers

<img alt="Providers banner" src="https://github.com/user-attachments/assets/c7b32a3e-452c-4209-91ef-71bcd895e2df" />

### Supported CLI Providers

Yoda currently supports 26 CLI providers, and we are adding new ones regularly. If you miss one, let us know or create a PR.

| CLI Provider | Status | Install |
| ----------- | ------ | ----------- |
| [Amp](https://ampcode.com/manual#install) | ✅ Supported | <code>npm install -g @sourcegraph/amp@latest</code> |
| [Auggie](https://docs.augmentcode.com/cli/overview) | ✅ Supported | <code>npm install -g @augmentcode/auggie</code> |
| [Autohand Code](https://autohand.ai/code/) | ✅ Supported | <code>npm install -g autohand-cli</code> |
| [Charm](https://github.com/charmbracelet/crush) | ✅ Supported | <code>npm install -g @charmland/crush</code> |
| [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) | ✅ Supported | <code>curl -fsSL https://claude.ai/install.sh &#124; bash</code> |
| [Cline](https://docs.cline.bot/cline-cli/overview) | ✅ Supported | <code>npm install -g cline</code> |
| [Codebuff](https://www.codebuff.com/docs/help/quick-start) | ✅ Supported | <code>npm install -g codebuff</code> |
| [Codex](https://github.com/openai/codex) | ✅ Supported | <code>npm install -g @openai/codex</code> |
| [Continue](https://docs.continue.dev/guides/cli) | ✅ Supported | <code>npm i -g @continuedev/cli</code> |
| [Cursor](https://cursor.com/cli) | ✅ Supported | <code>curl https://cursor.com/install -fsS &#124; bash</code> |
| [Devin](https://cli.devin.ai/docs) | ✅ Supported | <code>curl -fsSL https://cli.devin.ai/install.sh &#124; bash</code> |
| [Droid](https://docs.factory.ai/cli/getting-started/quickstart) | ✅ Supported | <code>curl -fsSL https://app.factory.ai/cli &#124; sh</code> |
| [Gemini](https://github.com/google-gemini/gemini-cli) | ✅ Supported | <code>npm install -g @google/gemini-cli</code> |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) | ✅ Supported | <code>npm install -g @github/copilot</code> |
| [Goose](https://block.github.io/goose/docs/quickstart/) | ✅ Supported | <code>curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh &#124; bash</code> |
| [Kilocode](https://kilo.ai/docs/cli) | ✅ Supported | <code>npm install -g @kilocode/cli</code> |
| [Kimi](https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html) | ✅ Supported | <code>uv tool install kimi-cli</code> |
| [Kiro (AWS)](https://kiro.dev/docs/cli/) | ✅ Supported | <code>curl -fsSL https://cli.kiro.dev/install &#124; bash</code> |
| [Letta](https://docs.letta.com/letta-code/cli) | ✅ Supported | <code>npm install -g @letta-ai/letta-code</code> |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | ✅ Supported | <code>curl -LsSf https://mistral.ai/vibe/install.sh &#124; bash</code> |
| [OpenCode](https://opencode.ai/docs/cli/) | ✅ Supported | <code>npm install -g opencode-ai</code> |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | ✅ Supported | <code>npm install -g @mariozechner/pi-coding-agent</code> |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | ✅ Supported | <code>npm install -g @qwen-code/qwen-code</code> |
| [Rovo Dev](https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/) | ✅ Supported | <code>acli rovodev auth login</code> |

### Issues

Yoda allows you to pass issues, tickets, and support threads straight to your coding agent.

| Tool | Status | Authentication |
| ----------- | ------ | ----------- |
| [Linear](https://linear.app) | ✅ Supported | Connect with a Linear API key. |
| [Jira](https://www.atlassian.com/software/jira) | ✅ Supported | Provide your site URL, email, and Atlassian API token. |
| [GitHub Issues](https://docs.github.com/en/issues) | ✅ Supported | Connect your GitHub account or authenticate via GitHub CLI (`gh auth login`). |
| [GitLab Issues](https://docs.gitlab.com/user/project/issues/) | ✅ Supported | Provide your GitLab instance URL and a personal access token with `read_api` scope. |
| [Forgejo Issues](https://forgejo.org/) | ✅ Supported | Provide your Forgejo instance URL and API token. |
| [Plain Threads](https://www.plain.com/) | ✅ Supported | Connect with a Plain API key. |

# Contributing

Contributions welcome! See the [Contributing Guide](CONTRIBUTING.md) to get started, and join our [Discord](https://discord.gg/f2fv7YxuR2) to discuss.

# FAQ

<details>
<summary><b>What telemetry do you collect and can I disable it?</b></summary>

> We send **anonymous, allow‑listed events** (app start/close, feature usage names, app/platform versions) to PostHog.  
> We **do not** send code, file paths, repo names, prompts, or PII.
>
> **Disable telemetry:**
>
> - In the app: **Settings → General → Privacy & Telemetry** (toggle off)
> - Or via env var before launch:
>
> ```bash
> TELEMETRY_ENABLED=false
> ```
>
> Full details: see [Telemetry](https://lovstudio.ai/yoda/docs/telemetry).
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

> **App data is local‑first**. We store app state in a local **SQLite** database:
>
> ```
> macOS:   ~/Library/Application Support/yoda/yoda.db
> Windows: %APPDATA%\yoda\yoda.db
> Linux:   ~/.config/yoda/yoda.db
> ```
>
> **Privacy Note:** While Yoda itself stores data locally, **when you use any coding agent (Claude Code, Codex, Qwen, etc.), your code and prompts are sent to that provider's cloud API servers** for processing. Each provider has their own data handling and retention policies.
>
> You can reset the local DB by deleting it (quit the app first). The file is recreated on next launch.
</details>

<details>
<summary><b>How do I add a new provider?</b></summary>

> Yoda is **provider‑agnostic** and built to add CLIs quickly.
>
> - Open a PR following the **Contributing Guide** (`CONTRIBUTING.md`).
> - Include: provider name, how it’s invoked (CLI command), auth notes, and minimal setup steps.
> - We’ll add it to the **Providers table** and wire up provider selection in the UI.
>
> If you’re unsure where to start, open an issue with the CLI’s link and typical commands.
</details>

<details>
<summary><b>What permissions does Yoda need?</b></summary>

> - **Filesystem/Git:** to read/write your repo and create **Git worktrees** for isolation.  
> - **Network:** only for provider CLIs you choose to use (e.g., Codex, Claude) and optional GitHub actions.  
> - **Local DB:** to store your app state in SQLite on your machine.
>
> Yoda itself does **not** send your code or chats to any servers. Third‑party CLIs may transmit data per their policies.
</details>


<details>
<summary><b>Can I work with remote projects over SSH?</b></summary>

> **Yes!** Yoda supports remote development via SSH.
>
> **Setup:**
> 1. Go to **Settings → SSH Connections** and add your server details
> 2. Choose authentication: SSH agent (recommended), private key, or password
> 3. Add a remote project and specify the path on the server
>
> **Requirements:**
> - SSH access to the remote server
> - Git installed on the remote server
> - For agent auth: SSH agent running with your key loaded (`ssh-add -l`)
>
> See [Remote Projects](https://lovstudio.ai/yoda/docs/remote-projects) for detailed setup instructions and [Bring Your Own Infrastructure](https://lovstudio.ai/yoda/docs/bring-your-own-infrastructure) for technical details.
</details>

[![Follow @lovstudio](https://img.shields.io/twitter/follow/lovstudio?style=social&label=Follow%20%40lovstudio)](https://x.com/lovstudio)
