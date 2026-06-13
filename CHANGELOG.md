# Changelog

All notable changes to Yoda will be documented in this file.

The public Yoda changelog starts at **0.1.0**. Earlier non-Yoda release history
is preserved in git tags only.

## 0.11.1 — 2026-06-13

### Changed

- Run-mode selection switches to a card layout with explicit confirmation.
- Compare mode groups its child tasks under a session-less parent task.

## 0.11.0 — 2026-06-13

### Added

- **Automation engine (P1)**: an in-process scheduler (croner) rebuilt from the
  DB on boot, with manual / cron triggers, timezone and next-run-time editing, a
  last-run status dot, and an `automation_runs` history table. Runs execute from
  the main process via `createTask` (landing in internal Drafts, auto-approved),
  back-filled by agent session events; overlapping runs are skipped and
  interrupted runs are swept on startup. (Running against a real project branch
  is deferred to P1b.)
- **Split view**: the main content area can show multiple tasks side by side.
- **Global side pane full-window expand**: the global sidebar can expand to fill
  the whole window.
- **Run-mode picker reworked**: a Dialog-based picker with fixed-width agent
  labels and single-line compact agent cards; "compare" is split into its own
  group and renamed to "探索" (Explore).

### Changed

- Sidebar reorganized: Automation and Skills move into the task area (alongside
  each other); Settings moves after Mobile. The Runtime settings page is merged
  into a single accordion, and the legacy review-prompt setting is removed.

### Fixed

- Team mode workers run as sessions of the same task rather than separate tasks;
  compare-mode candidates are isolated in their own worktrees with parent/child
  grouping.
- Agents account tab: responsive tables and tab strips (icon-only on narrow
  panels, threshold raised to 820px), accordion details grow with content, and
  long emails truncate instead of wrapping.

## 0.10.4 — 2026-06-13

### Added

- Warp Preview detection plus a CLI PATH fallback scan for runtime discovery.
- View menu gains a "Toggle Left Sidebar" checkbox.

### Fixed

- macOS: closing the last window now hides the app so reopening from the dock
  doesn't replay the boot screen; clicking the dock reopens the main window.
- Titlebar nav no longer occasionally disappears from `isLeftOpen` mirror-state
  drift; collapsing the sidebar falls back to the default titlebar with nav
  buttons intact.
- Font picker: hover feedback restored (uses `background-1`), and the popover
  widens to 260px so the placeholder isn't truncated.
- Home: the inert "+" button is hidden when the app tab strip is hidden.
- Boot screen: the bottom-right code block aligns with the left boot log.
- **Login-shell env capture wrapped in sentinels** (`__YODA_ENV_START__` /
  `__YODA_ENV_END__`, mirroring VS Code's shell-env): interactive-shell banner
  noise (powerlevel10k instant prompt, oh-my-zsh, version-manager banners) no
  longer pollutes the parsed `PATH`, fixing GUI launches where `claude` / `tmux`
  and other CLIs went undetected despite being on the user's PATH.

## 0.10.3 — 2026-06-13

### Added

- **Sticky tabs**: a tab dragged back from another scope stays in the current
  tab strip alongside its origin — drop position decides activation, cross-scope
  drops surface a "go to" toast, and `stripScope` is decoupled so a sticky tab
  renders content without rewriting the strip.
- **Tab drag completion**: the main content area accepts drag-backs on every
  route's central column, bottom terminal tabs support drag reordering, and
  global-sidebar copy pins (view/overview) can return to the main window.
- **Boot flow rework**: the main window shows immediately with a static splash
  (centered Hood mark) covering the renderer loading phase, then waits for
  user confirmation to enter.
- The scripts list gains a "new script" row linking to project settings;
  `releases.lovstudio.ai` update feed resurrected via a Vercel redirect.

### Changed

- Packaged builds ship only native deps and bundle the rest into `out/`,
  slimming the install footprint.
- Composer settings popover visual hierarchy rebuilt with tightened spacing
  and width-adaptive toolbars.

### Fixed

- **Updater race**: releases are now created as drafts and published only
  after all platform assets upload — mac update checks no longer 404 during
  the upload window.
- Tab dragging is pointer-driven, fixing real drags not registering; drops no
  longer switch routes unexpectedly.
- About panel shows the app version instead of the Electron version in dev.

## 0.10.2 — 2026-06-12

### Added

- **Composer principles**: the composer settings popover can toggle individual
  atomic prompt principles, with instruction-file viewing and management;
  comments move to icon hover.
- **Cross-area tab moves**: tab drag-and-drop and right-click move now work
  across all three tab areas.
- **Bottom panel modes as tabs**: mode switching is flat tabs aligned with the
  sidebar chip design; each mode tab can detach independently, and empty
  states show feature cards matching sidebar interactions.
- Mobile gateway hardened across desktop restarts and network changes; Expo
  Metro restarts when the LAN host changes.

### Fixed

- App startup no longer blocks ~4s on login-shell environment capture —
  `resolveUserEnv` runs as async exec.
- Update manifests pin versioned URLs, enabling differential downloads.
- Composer popover ContextItem no longer crashes outside a task view.
- Boot screen blink cursor falls back to a muted hollow outline.

## 0.10.1 — 2026-06-12

### Added

- **AI Lab as an App center**: the lab view is rebuilt around a launcher grid
  backed by an App registry, ready to host more built-in apps beyond logo
  generation.
- **Navigation slimmed down**: the sidebar nav keeps four entries — website /
  docs / settings / feedback; Kanban, AI Lab, and Roadmap move into settings
  tabs, and the website gains a Roadmap page.
- Browser history entries can be deleted from the list.

### Changed

- **Brand v17 rollout continues**: the landing page cover (hero background +
  og:image) is rebuilt around The Hood identity, and the README aligns with
  the v17 brand layer (mark in the heading, official backronym, design-language
  link).

### Fixed

- The nav section popped out from the sidebar version anchor now collapses
  when clicking outside.
- Lint no longer scans `.worktrees/**` artifacts from the parent checkout.

## 0.10.0 — 2026-06-12

### Added

- **New brand identity — “The Hood”**: a vectorized mark (rounded-triangle
  robe, teardrop cowl negative space, one luminous presence inside) drawn from
  the ygreen theme. Rolled out everywhere: macOS/Windows/Linux app icons (with
  distinct beta/canary dot colors), in-app lockups (mark + YODA wordmark with
  outlined type), the boot screen now opens with the breathing mark, the
  landing page is rethemed to the identity, and a new `/design/` page on
  yoda.lovstudio.ai documents the full identity system (mark anatomy, lockup
  sizing rules, icon variants, palette).
- **AI Lab**: logo/image generation view with dual engines (ZenMux Vertex
  protocol and Codex CLI).
- **AI invocation logs**: a settings tab recording every AI call from start to
  finish — including per-turn prompts of interactive sessions — shown as a
  table; rows are written at call start (`running`) so hangs are visible.
- **Markdown Front Matter rendering**: key-value table at the top of rendered
  Markdown, nested objects flattened to dot-path rows, tolerant of BOM and
  leading blank lines.

### Changed

- Worktree paths flattened and hash-mode branch names shortened.
- Task menu assembly extracted into `useTaskMenuActions`; the top overview tab
  reuses the same task menu.
- Settings navigation column: breakpoint tuning, fit-content width, and
  scroll-constraint fixes for the bottom tabs.

### Fixed

- Session panel sections no longer disappear when main-area file tabs close,
  and the file menu no longer deadlocks after switching panels.
- Interactive session logs record the actual agent command instead of the
  tmux wrapper command.

## 0.9.0 — 2026-06-12

### Added

- **Cross-project Agent kanban (Alpha)**: a board view spanning projects —
  drag tasks between status columns, per-column configurable hooks, and card
  hover peek showing the summary, diff stats, and session state.
- **Skills, round two**: trigger testing (one-click verify that a skill would
  actually fire), generalized AI iteration (free-form edits, fork copies,
  linked trigger tests), a tree layout grouping skills by name prefix
  (brand/author) with count and length sorting, real invocation stats with
  multi-dimensional sorting (alphabetical by default), and skills treated as
  files via the shared file-action components; detail header reworked with
  actions consolidated into a single overflow menu.
- **Custom run principles**: a new Prompts settings page whose content is
  injected as a system prompt at session start, with a persona section
  rendered in the context panel.
- **Status aggregation**: sidebar task rows roll up session states by display
  priority — awaiting input > awaiting review > running > marked unread >
  idle; session tab icons reflect run state, and the task-level icon keeps
  only a notification signal that jumps to the pending session on click.
- **Branch controls split**: branch selection and fork-or-not are independent
  controls; non-fork runs can check out an existing branch.
- File menu settled into three groups (in-app locations / IDE incl. Finder /
  copy path); the "(current)" marker is detected at runtime; global files can
  open in the sidebar of the current task.

### Fixed

- Third-party IME Chinese punctuation fix is enabled by default, with
  composition guards.
- Dropping a file onto the prompt input attaches it instead of opening a new
  window.
- Stale worktree directory removal failures are surfaced instead of
  swallowed.
- RelativeTime "ago" mode no longer renders a literal `{{time}}` or
  duplicated suffixes; attachment chip labels are no longer clipped.

## 0.8.0 — 2026-06-12

### Added

- **Theme lineup**: the Matrix palette is promoted to a first-class `ydark`
  theme, joined by 尤达绿 II / 尤达白 II variants; follow-system mode lets you
  pick which light/dark pair to alternate between.
- **Kernel-boot startup screen**: a boot-log style splash that exits on the
  app's ready signal.
- **Browser as a persistent card**: the in-app browser is now a standing
  feature card (Codex-style single page + history) instead of ad-hoc tabs.
- **Skills overhaul**: skill detail opens as a top-level tab instead of a
  modal; invocation stats gain daily history with a 30-day trend chart;
  skills support pinning; the detail page is responsive in narrow containers
  (actions collapse into an icon row / overflow menu).
- **Settings reorganization**: a new "Session" tab groups naming, summary,
  and pre-archive skill options (tmux moved there too); branch auto-naming is
  configurable (time-hash default / AI semantic); worktree location is a
  two-way choice (in-project `.worktrees` / unified directory) with a global
  default; settings pages and embedded views adapt via container queries,
  with a chip-row tab switcher in the sidebar.
- **Side-pane everywhere**: all top-level tabs can open in the sidebar with
  the shell-level cross-route side pane restored; nav items and shortcut
  icons support right-click / Opt+click to open in the global side pane,
  which gains a close button.
- **File actions**: the shared file menu supports opening in the sidebar or
  global sidebar, covers out-of-workspace and global files uniformly, and
  agent-home read-only access extends to `~/.claude` and `~/.codex`.
- Tab polish: the tab icon slot morphs into a close button on hover (no
  trailing close slot); the "+" button stays pinned at the right edge on
  overflow; the app menu is regrouped (About + Updates first, Restart next
  to Quit).

### Changed

- **Naming direction flipped**: the session name is now the source of truth —
  task names follow it, and branch names are decoupled from titles.

### Fixed

- Explicitly stored `null` settings are no longer treated as missing and
  reset to defaults.
- Force turn-started when an answered interactive tool resolves
  awaiting-input, fixing stuck run states.

## 0.7.0 — 2026-06-11

### Added

- **In-app browser pane**: URLs clicked in the terminal (smart links, OSC 8
  hyperlinks, link gestures) open in a sidebar webview tab with back / forward
  / refresh, an address bar, and an open-in-system-browser action. Re-clicking
  the same URL activates its existing tab; tab position and title persist with
  view snapshots. `_blank` popups navigate in place and non-http(s) URLs are
  denied.

### Changed

- **Sidebar version anchor**: the bottom account row is replaced by a
  logo + product name + version anchor that toggles the nav section; when an
  update is available the version turns accent-colored with a download
  shortcut to Settings → General.

## 0.6.0 — 2026-06-11

### Added

- **Branch finish flow**: a status-aware titlebar CTA with review / merge /
  archive panels — local squash merge via RPC, AI-generated commit messages,
  and a conflict-resolution agent.
- **Branch display modes**: sidebar task rows support three branch-display
  tiers (hidden / compact / full); compact mode shows the branch suffix in a
  fixed leading gutter, with two-line layout in full mode.
- **Prompt history blinds**: the status bar expands prompt history in-place
  with a push-up "blinds" layout — click to jump to the matching terminal
  position, configurable head/tail line counts, persisted expansion.
- **Archived review**: archived sessions and subtasks expand in place for
  inspection, with a read-only transcript viewer; session archiving gains
  sub-options (direct / with skill / configure).
- **Project-level token stats** with multi-dimensional visualizations; the
  token usage card now auto-refreshes incrementally as turns complete.
- **Workspace ownership**: projects belong to a single workspace — conflicts
  surface an explicit three-way dialog, and moving a project follows it with
  the view.
- **Roadmap reports**: all learn-agent-design research reports are published
  and linked from the roadmap view.
- Device-flow login dialog redesigned with prefetched codes for instant
  display; mobile connect page reworked into a two-step guide; task index
  tabs show "project / branch".

### Changed

- **Bottom panel rebuilt as tabs**: the drawer is now a multi-content tab bar
  (terminal / session), scripts split into a standalone mode, the drawer
  sidebar removed, and a horizontal expand toggle controls how the bottom bar
  relates to the sidebar. Visibility and mode are global preferences persisted
  across tasks and sessions.
- Terminal settings promoted to a top-level tab with auto-copy on by default;
  prompt history migrated into the session tab.
- Status bar truncation counts centered, toggle entry moved to a config icon,
  hover expand/collapse arrows added.

### Fixed

- OSC 52 handled in the PTY so tmux copy-mode selections reach the clipboard.
- Project tabs persist with an explicit view, fixing intermittent dead clicks
  when opening project details; pinned tabs are synthesized from visibleTabs.
- Slug separators normalized to hyphens; tab titles strip the branch prefix.
- "Configure in project settings" jumps directly to the project settings page;
  compact-tier indentation unified across sidebar task lists.

## 0.5.0 — 2026-06-11

Version note: 0.5.0 skips the 0.3.12–0.4.x range, which is occupied by
preserved pre-Yoda release tags.

### Added

- **Scoped app tabs**: a top-level tab system with per-scope tab strips — tabs
  can be pinned to the task sidebar strip, duplicated into full windows (Window
  → Duplicate), and the task title bar is slimmed down to three controls.
- **Usage stats**: a new stats domain parses Claude/Codex transcripts into
  token usage — usage overview view with a token heatmap, per-session usage
  chips, a project token-usage card, and task diff snapshots.
- **Nested subtasks**: tasks support arbitrary-depth parent/child hierarchies
  with collapsible sidebar trees and a new-subtask modal.
- **Session panel overhaul**: section visibility/order management, summary
  snapshots, a Statusline section with template switching, hooks section
  counts, and per-session token usage grouping.
- **Composer attachments**: native image paste and file chips as inline atomic
  tokens, injected in text order with configurable transfer modes.
- **Roadmap view**: an embedded research roadmap with report states.
- Built-in **Yoda Warm** theme; PDF inline preview in the editor; built-in
  Agent entities for internal LLM utilities; subscription account service with
  official-API probe and model pricing table; Fumadocs docs site.

### Changed

- **Terminology: provider → runtime** across settings, selectors, registry,
  and i18n — a Runtime is the CLI execution environment, an Agent is the
  prompt+skills entity.
- Sidebar navigation consolidated into a settings hub; account row hosts quick
  icons; workspace switcher menus flattened with attention-count badges.
- Task area reworked to a bottom-bar-first layout with a full-width terminal
  drawer in tabbed layout; two-axis task sorting with a view-options panel.
- Archive orchestration moved into the main process — archives survive
  renderer reloads, with task/conversation archive two-way linking.
- Terminal resize pipeline rebuilt: freeze layer + rAF-throttled commits
  eliminate white flashes, jitter, and rubber-banding; sidebar exit is
  pixel-isolated via flexbox.
- Session titles prefer user > yoda > agent naming; home greeting rewritten.

### Fixed

- Smart path links survive Claude Code's hard-wrapped lines (cross-line
  reassembly for paths and URLs); path detection stops at ASCII brackets.
- Interrupt markers suppress zombie "working" states from stateless
  re-derivation; questionnaire awaiting states sync correctly.
- Multiline prompt injection no longer renders literal `\n`; per-session
  resize IPC dedup fixes narrow CLI rendering after unpin.
- Cmd+Z works in the composer again; unified IME composition guards across
  inputs; tooltip triggers no longer collapse icon-button heights.
- Renaming an unprovisioned task no longer fails silently; Metro lazy-starts
  and cleans up orphaned processes on mobile.

## 0.3.11 — 2026-06-09

### Added

- **Customizable sidebar**: reorder and hide the secondary navigation items via
  a drag-and-drop "Customize sidebar" settings card, backed by a single source
  of truth for nav items.
- **Live agent runtime indicators**: a new agent runtime store surfaces
  running/attention badges per task across the sidebar and workspace switcher,
  with workspace-level task counts.
- **Conversation runtime aggregation**: aggregate per-conversation running/idle
  state across projects and tasks.
- Expand the mobile gateway and mobile app to consume runtime status with a
  richer in-app UI.

### Changed

- Consolidate prompt-injection logic into a shared payload builder (Claude stays
  raw; other providers wrap multiline payloads in bracketed paste).
- Refine Claude/Codex run-state sources and keep the specific awaiting-input
  sub-state on non-forced turn starts, so permission/elicitation prompts are no
  longer clobbered by a bare "working" spinner.
- Rename the repository settings card to a GitHub settings card.

## 0.3.10 — 2026-06-09

### Added

- **Workspaces**: group and switch projects into named workspaces from the
  sidebar, with a workspace switcher and a new bottom account/user entry.
- **Configurable agents**: define and manage custom agent entities (create,
  edit, manage) and surface provider + model summaries on the home run controls.
- **Agent hooks inspector**: inspect agent hook executions with exec
  enrichment/shim and per-hook overrides (apply + persisted store).
- Add a redesigned task view split into overview, session, harness, and hooks
  panels, plus background auto-rename and pre-archive skill execution.
- Add Claude/Codex run-state sources and transcript parsing, on-demand session
  summary generation, conversation runtime status, and a conversation restart
  flow.

### Changed

- **Rework agent run-state synchronization** so the running/idle indicator is
  accurate — fixing stuck spinners and conversations that looked busy when idle.
- Refresh the sidebar (workspace grouping, unified nav icons, account entry) and
  command-palette scoped search with fuzzy skill autocomplete.
- Let the project selector show full paths and correctly attribute
  subdirectories; improve session prompt previews.
- Improve PTY terminal sizing and rendering (right-edge overflow, tmux scroll
  residue, restart half-screen).

### Fixed

- Fix agent running-state desync that caused stuck spinners and wrong idle state.
- Stop the sidebar from spinning indefinitely when a pre-archive skill runs.
- Fix terminal right-side overflow, trailing whitespace, and tmux scroll
  artifacts; fix restart-task menu and half-screen terminal.
- Fix macOS "Open in Finder" to enter the folder instead of highlighting the
  parent directory.

## 0.3.9 — 2026-06-07

### Added

- Add the Expo mobile app workspace and a token-protected desktop mobile gateway
  for viewing project/task state and creating new requests from mobile.
- Add project sessions views and issue/task linking improvements across project
  overview and issue surfaces.
- Add model candidate discovery, agent model settings, and skill usage/validation
  details in the desktop UI.
- Add task/session naming helpers, rename flows, archive support, and richer
  conversation runtime state.

### Changed

- Refresh home, task, sidebar, skills, settings, theme, and context-panel UI
  flows for denser task navigation and clearer session state.
- Expand agent-facing docs for mobile development and update workspace/package
  scripts for mobile commands.
- Improve PTY link handling, terminal sizing, custom themes, and provider/model
  configuration plumbing.

### Fixed

- Harden task archiving, quit-session prompts, Codex session restoration, and
  session-title generation.
- Fix issue list synchronization, sidebar persistence, task title display, and
  renderer error isolation.
- Improve i18n coverage and terminology consistency.

## 0.3.8 — 2026-06-04

### Added

- Add Codex session recovery support that can restore rollout terminal history
  and reuse the original Codex session id when reopening or unarchiving
  historical conversations.
- Add richer task/session context actions, including copyable basic session
  info, resolved resume commands, project paths, working directories, and
  provider details from task menus.
- Add task tab-strip coverage for task sessions so terminal and conversation
  navigation state is easier to preserve across task views.

### Changed

- Default tmux task settings to enabled for new project settings so long-running
  agent sessions are protected by default.
- Clarify Yoda's independent project branding and remove the legacy automatic
  Emdash data-directory migration path.

### Fixed

- Improve PTY drag selection auto-copy reliability, including terminals running
  in mouse mode.
- Harden Codex session title extraction and session info resolution across
  mounted projects and archived task states.

## 0.3.7 — 2026-06-02

### Added

- Add Codex context-panel support with runtime metadata, system/developer
  messages, memory files, dynamic tools, turn context, and session prompts.
- Add live Codex/Claude skill and agent scanning so context details refresh from
  user, project, and plugin directories instead of relying only on startup
  transcript snapshots.
- Add tmux session persistence on app quit, including keep-running decisions,
  fallback notifications when tmux is unavailable, and install actions from
  task settings.
- Add task context-menu copy actions for session id, project path, and provider
  resume command.
- Add Typeless voice-input integration on the home prompt.

### Changed

- Move projectless workflows into the regular task pipeline through the internal
  Drafts project, including automatic return to Home after Drafts sessions exit.
- Refresh context-panel layout with scrollable long sections, grouped MCP tools,
  cleaner skill parsing, and denser context rows.
- Let task titles start rename on click and show concrete IDE names in Open In
  controls.
- Upgrade Electron to 41.7.1 and align native dependency rebuilding for the new
  runtime.

### Fixed

- Harden startup and repository handling for non-git directories and broken
  skill symlinks.
- Fix sidebar HMR row positioning by separating virtualizer layout from drag
  transforms.
- Fix Vitest better-sqlite3 ABI mismatches by using a Node-ABI test shim while
  preserving Electron ABI rebuilds for app runtime.
- Suppress noisy IME diagnostic logging.

## 0.3.6 — 2026-06-02

### Added

- Add `yoda://` and `yoda-canary://` deep links for opening a specific task
  session from another app, including anchors for a prompt id or prompt index
  in the Claude context panel.
- Register the production and canary app protocol handlers in packaged builds
  and route cold-start or already-running deep links into the renderer.

### Changed

- Refresh the home run controls with inline run-mode tabs, explicit local/SSH
  host display, and review-mode branch strategy selection.

## 0.3.5 — 2026-05-31

### Added

- Add richer projectless workflows from the home view, including compare,
  review, team, path mention autocomplete, skill shortcuts, and resumable
  projectless sidebar sessions.
- Add the MaaS dashboard and ZenMux usage integration, with encrypted API key
  storage and invocation history views.
- Add task review markers, archive-without-command handling, Claude context
  inspection, and Codex title generation support.
- Add sidebar grouping modes, pinned projects, projectless session rows, and
  expanded tests around the new task, conversation, terminal, and logger flows.

### Changed

- Remove the task titlebar conversation switcher and shift conversation
  navigation into the updated task surface.
- Improve the development Electron bundle preparation so the local macOS app
  keeps Yoda metadata without repeatedly patching the installed Electron app.
- Surface copyable debug information on toasts and route more failures through
  structured logger metadata.

### Fixed

- Stabilize PTY first-layout measurement, restored views, bottom spacing, and
  dark Codex input readability.
- Improve terminal file links and optional IME diagnostics/native punctuation
  handling.
- Tighten projectless default directory creation, conversation resume behavior,
  and path completion safety checks.

## 0.3.4 — 2026-05-25

### Fixed

- Route stable auto-update checks through GitHub Releases and publish the
  generated update manifests and blockmaps with production release artifacts.
- Merge macOS x64 and arm64 update manifests so both architectures can discover
  the latest release from the same feed.

## 0.3.3 — 2026-05-25

### Added

- Add projectless home sessions that can run without creating a project task or
  worktree.
- Add the docs app entrypoint and build configuration.

### Changed

- Rename the no-project selector option to "Do not use a project" /
  "不使用项目" and explain the behavior on hover.
- Improve update check state handling and user-facing update messages.

## 0.3.2 — 2026-05-25

### Added

- Add renderer i18n coverage for the main workspace, settings, projects, tasks,
  integrations, MCP, skills, and shared UI surfaces.

### Fixed

- Fix Chinese language resolution so Settings → Language updates the interface
  immediately instead of falling back to English.
- Translate remaining top-level Chinese labels and render localized select
  values in settings controls.

## 0.3.1 — 2026-05-21

### Fixed

- Suppress Octokit request logging so GitHub API failures cannot write noisy
  stderr output through the default logger.
- Allow task creation to continue when no project is selected, including an
  explicit no-project option in the selector.
- Publish GitHub Release notes from `CHANGELOG.md`.

### Changed

- Refresh public download links and agentic CLI reference docs.

## 0.3.0 — 2026-05-12

### Added

- **Lovcode integration**: new `lovcode` main-process controller and
  service (`checkAvailability`, `search`). Command palette gains a
  Lovcode-backed search source, an install banner when Lovcode isn't
  detected, and shared types in `src/shared/lovcode.ts`.
- **Agents view**: dedicated renderer feature under
  `src/renderer/features/agents/` with its own view registry entry and
  `agents_viewed` telemetry event.
- **Command palette qualifiers**: structured query qualifiers
  (`qualifiers.ts`) and a Lovcode search hook
  (`use-lovcode-search.ts`).
- **Custom command on archive**: tasks can run a project-defined command
  before archiving (`src/renderer/features/projects/run-project-command.ts`).
- **Mark task for review**: new task state plus surfacing in the sidebar
  and task titlebar.
- **Project aliases**: projects can carry a custom alias used in UI and
  search.
- **Claude session metadata**: new
  `src/main/core/conversations/getClaudeSessionMetadata.ts` helper for
  resolving Claude session identity.
- **Project overview view**: new `overview-view/` panel for projects.
- **Task panel**: extracted `task-panel.tsx` to host the task surface.

### Changed

- Command palette modal refactored to support multiple search sources
  (Lovcode, qualifiers, built-ins) with shared scoring/filtering.
- Conversations controller and panel updated to consume Claude session
  metadata and surface it in the create-conversation modal.
- Settings schema and project-settings shared types extended for
  archive-command and alias fields. Settings registry wired accordingly.
- Sidebar and task titlebar reflect the new mark-for-review and
  alias-aware project naming. Agent status indicator polished.
- i18n: large new key set in `en.json` and `zh-CN.json` for Lovcode,
  agents, qualifiers, archive note, and review states.
- Telemetry `FocusView` adds `'agents'`.
- Navigation store and keyboard shortcuts wired for the new agents view.

### Fixed

- PTY: pure CJK / non-ASCII messages now correctly trigger the sidebar
  "working" state.
- Tasks: in-flight lock added when archiving so a task cannot be
  double-archived.
- Tooltip: nested-`button` hydration warning from `TooltipTrigger` fixed.

### CI

- Dropped the `nix-build` workflow.

## 0.2.0 — 2026-05-12

### Added

- Home draft persistence (prompt, project, strategy, provider) via a new
  `homeDraft` app setting. Includes an opt-in "express mode" so the
  sidebar `+` button can create a task instantly using the last
  configured runtime.
- Time-of-day greeting on the home view, using the account profile name.
- Optional **archive note** when archiving a task — surfaced inline on
  task rows and gated behind a new `Archive task with note…` menu entry.
  Drizzle migration `0013_rare_dagger` adds the `archive_note` column.
- "Archived only with notes" filter in the project task view.
- `name` field on the account profile (alongside `username`), updated
  from device-flow and refresh-token responses, displayed on the
  Settings → Account tab.

### Changed

- Sidebar: collapsible "Pinned" and "Projects" groups (persisted),
  project filter (all / local / SSH), sort menu, expand/collapse all,
  reset task order. Project / task / pinned-task rows share the refreshed
  visual language.
- Strategy chip on the home view now reads "Worktree" / "In-place" with
  descriptive popovers explaining the trade-offs.
- `useEffectiveProvider` accepts an external override so the home view
  can bind provider selection to the persisted draft.
- Resize handles in the task layout suppress panel-transition
  animations while dragging, and guard against redundant
  collapse/expand churn. Task titlebar shows the current branch next to
  the project chip. Agent-selector popover sizes to content.

### Fixed

- Feedback submission no longer relies on a Discord webhook. The
  renderer hook calls a new `feedback` RPC controller that posts to the
  Yoda backend with multipart form data (message, category,
  attachments, app version), authenticated via the session token.
- Boot ordering in `src/main/index.ts`: `resolveUserEnv()` now runs in
  the background so a heavy zsh login shell can no longer add 1–2s to
  app launch; app settings and the RPC router are initialized before
  the main window is created so the renderer's first paint never races
  IPC.
- New-terminal hotkey in `TerminalsPanel` uses
  `conflictBehavior: 'replace'`.
- PR controller and PR sync scheduler replace dynamic imports with
  static ones (per project convention).

### Dev / DX

- `.npmrc` pins `use-node-version=24.14.0` for consistent pnpm runs.
- `pnpm run d` uses `--prefer-frozen-lockfile --reporter=append-only
--silent` to quiet routine installs.
- `scripts/dev.ts` filters known-noisy Electron/macOS log lines unless
  `YODA_DEV_VERBOSE=1` is set.
- `scripts/postinstall.ts` renames the dev Electron.app bundle to
  "Yoda" on macOS so the dock label matches prod.
- `electron-vite` main/preload builds use `emptyOutDir: true` and
  suppress non-actionable `DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE`
  warnings.
- Kimi CLI doc URL updated to its new `moonshotai.github.io` location.

## 0.1.3 — 2026-05-11

### Added

- Project archive / unarchive operations with corresponding sidebar UI
  affordances and right-click menu entries.
- Session-title module (`src/main/core/session-title/`) that derives
  human-readable conversation titles from Claude transcripts.
- i18n string coverage for the new sidebar and create-task flows
  (English + Simplified Chinese).
- Drizzle migrations `0011_deep_wolf_cub` and `0012_tired_cammi` for the
  archive flag and session-title fields.

### Changed

- Sidebar redesign: project items, project menu, task items, and the
  left sidebar shell now share a consistent visual language with the
  refreshed home view.
- Create-task modal: branch picker, from-branch / from-issue / from-PR
  flows, and the initial-conversation section are unified around the
  new layout.
- `getProjects` and the project manager surface archived state to the
  renderer; `renameTask` and task utilities adapt to the shared task
  naming module.

### Removed

- Legacy `modal-context-bar`, `editor/file-tabs`, and
  `view/unified-main-tab-bar` components superseded by the redesign.

## 0.1.2 — 2026-05-11

### Added

- First release with full Apple Developer ID signing and notarization
  using the `lovstudio` org-level secrets (`APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY`) shared with `lovcode`.

## 0.1.1 — 2026-05-11

### Fixed

- Make Apple/Azure code signing and R2 upload conditional in
  `release-prod.yml` so the workflow can produce unsigned artifacts when
  optional secrets are absent. Adds GitHub Release upload as a fallback
  artifact destination.
- Switch macOS signing secrets to the `APPLE_CERTIFICATE` /
  `APPLE_CERTIFICATE_PASSWORD` / `APPLE_PASSWORD` naming used elsewhere
  in the lovstudio org.
- `notarize-mac.ts` now accepts either an App Store Connect API key
  (`APPLE_API_KEY*`) or an Apple ID + app-specific password
  (`APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`).
- `electron-builder.config.ts` reads `YODA_DISABLE_WIN_SIGNING` and
  `YODA_DISABLE_MAC_SIGNING` to opt out of code signing per-build.

## 0.1.0 — 2026-05-11

First Yoda release. This version establishes the independent product identity
and includes a number of UX and infrastructure changes.

### Added

- Finalize Yoda naming across the app, packaging, sign-in flow, and branding
  assets.
- Sign-in via Lovstudio device flow.
- i18n: bootstrap `i18next` + `react-i18next` with English and Simplified
  Chinese locales; translate the settings, onboarding, MCP, and skills views;
  add a Language card to settings.
- Pinyin-aware task slug generation via `pinyin-pro`.
- New home view with project + agent selectors and quick actions.
- Sidebar restructure (project items, task items, project menu).
- Richer task context menu and a new "Manage run scripts" modal.
- Refreshed task titlebar and unified main tab bar.

### Changed

- Centralize task name slug logic in `src/shared/task-name.ts` (shared between
  main and renderer).
- Drop the renderer-only `utils/taskNames` helper.

### Removed

- Unused `comments-popover` and `context-bar` components from the
  conversations panel.
