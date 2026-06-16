export const RUNTIME_IDS = [
  'codex',
  'claude',
  'devin',
  'qwen',
  'droid',
  'gemini',
  'cursor',
  'copilot',
  'amp',
  'opencode',
  'hermes',
  'charm',
  'auggie',
  'goose',
  'kimi',
  'kilocode',
  'kiro',
  'rovo',
  'cline',
  'continue',
  'codebuff',
  'mistral',
  'jules',
  'junie',
  'pi',
  'letta',
  'autohand',
  'antigravity',
  'grok',
] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];

export type RuntimeDefinition = {
  id: RuntimeId;
  name: string;
  /** Short one-liner shown in the agent info card. */
  description?: string;
  docUrl?: string;
  installCommand?: string;
  commands?: string[];
  versionArgs?: string[];
  detectable?: boolean;
  cli?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  /**
   * When true, the initial prompt is delivered via keystroke injection
   * (typing into the TUI after startup) instead of as a CLI argument.
   * Use for agents whose CLI has no flag for interactive-mode prompt delivery.
   */
  useKeystrokeInjection?: boolean;
  /**
   * When true, image attachments are delivered by writing each image to the
   * OS clipboard and sending Ctrl+V into the TUI — the CLI reads the clipboard
   * itself and renders a native image placeholder (e.g. "[Image #1]").
   * The initial prompt is then keystroke-injected after the images.
   * Runtimes without this flag receive images as @path text mentions.
   */
  clipboardImagePaste?: boolean;
  resumeFlag?: string;
  /** When true, append the session id as a positional argument after resumeFlag. */
  resumeSessionIdArg?: boolean;
  /**
   * CLI flag to assign a unique session ID per chat instance.
   * Used to isolate session state when multiple chats of the same provider
   * run in the same worktree. The flag receives a deterministic UUID
   * derived from the Yoda conversation ID.
   * e.g. '--session-id' for Claude Code.
   */
  sessionIdFlag?: string;
  /**
   * CLI flag that appends extra text after the runtime's own system prompt,
   * e.g. '--append-system-prompt' for Claude Code. Used to inject the
   * user-defined prompt principles. Runtimes without this flag or a config key
   * run unmodified.
   */
  appendSystemPromptFlag?: string;
  /**
   * Config override key for runtimes that accept developer/system prompt
   * additions through `-c key=value` instead of a dedicated CLI flag.
   */
  appendSystemPromptConfigKey?: string;
  newConversationFlag?: string;
  sessionIdOnResumeOnly?: boolean;
  defaultArgs?: string[];
  /** Prefix used for agent-native commands or skills inside the TUI. */
  commandPrefix?: string;
  /** Extra input sent before Enter when submitting compact agent-native commands. */
  commandSubmitSuffix?: string;
  /** Raw terminal input used to submit injected agent-native commands. */
  commandSubmitInput?: string;
  /** Delay before submit after prompt injection, used to avoid TUI paste-burst handling. */
  commandSubmitDelayMs?: number;
  /**
   * Non-interactive command template used for automated task renaming.
   * The prompt is written to stdin unless the template contains `{prompt}`.
   * `{model}` is replaced with the configured or inferred naming model.
   */
  namingCommand?: string;
  planActivateCommand?: string;
  autoStartCommand?: string;
  icon?: string;
  /** Accessible alt text for the provider logo. */
  alt?: string;
  /** When true, the logo should be colour-inverted in dark mode. */
  invertInDark?: boolean;
  terminalOnly?: boolean;
  supportsHooks?: boolean;
};

/** How to make a cheap authenticated request that proves an official API key works. */
export type OfficialApiProbeSpec = {
  /** Default API base; overridden by the base-url env var when set. */
  defaultBaseUrl: string;
  /** Path appended to the base URL, e.g. '/models'. */
  path: string;
  baseUrlEnvVar?: string;
  /** Env vars that may hold the API key; the first configured one wins. */
  authEnvVars: readonly string[];
  auth: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  headers?: Record<string, string>;
};

export type RuntimeAccountProfile = {
  officialSubscription: {
    supported: boolean;
  };
  officialApi: {
    envVars: readonly string[];
    probe?: OfficialApiProbeSpec;
  };
  maas: {
    supported: boolean;
    providerHints: readonly string[];
    modelHints?: readonly string[];
  };
};

export const AGENT_ACCOUNT_PROVIDER_IDS = [
  'official-subscription',
  'official-api',
  'yoda-maas',
] as const;

export type AgentAccountProviderId = (typeof AGENT_ACCOUNT_PROVIDER_IDS)[number];

export type RuntimeAccountStatus = {
  runtimeId: RuntimeId;
  officialApiEnvVars: string[];
  configuredApiEnvVars: string[];
  customApiEnvVars: string[];
  inheritedApiEnvVars: string[];
};

/** Result of an authenticated probe against the provider's official API. */
export type AgentApiProbeResult = {
  runtimeId: RuntimeId;
  /** Whether a probe endpoint is registered for this provider. */
  supported: boolean;
  ok: boolean;
  /** HTTP status when a response was received. */
  status: number | null;
  endpoint: string | null;
  error: string | null;
  checkedAt: string;
};

/** Token usage aggregated from the provider CLI's local session logs. */
export type AgentLocalUsage = {
  runtimeId: RuntimeId;
  /** Whether Yoda knows how to read this provider's local session logs. */
  supported: boolean;
  /** Lookback window in days. */
  days: number;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Estimated API-equivalent cost in USD, computed from the bundled price table. */
  costUsd: number;
  /** Models that contributed tokens but have no known pricing (their cost is excluded). */
  unpricedModels: string[];
  fetchedAt: string;
  error: string | null;
};

/** Subscription identity read from the provider CLI's local login state. */
export type AgentSubscriptionAccount = {
  runtimeId: RuntimeId;
  /** Whether Yoda knows how to read this provider's local account info. */
  supported: boolean;
  loggedIn: boolean;
  email: string | null;
  displayName: string | null;
  organization: string | null;
  plan: string | null;
  error: string | null;
};

export const RUNTIMES: RuntimeDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    description:
      'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
    docUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex',
    commands: ['codex'],
    versionArgs: ['--version'],
    cli: 'codex',
    autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox',
    initialPromptFlag: '',
    appendSystemPromptConfigKey: 'developer_instructions',
    resumeFlag: 'resume',
    resumeSessionIdArg: true,
    commandPrefix: '$',
    commandSubmitSuffix: ' ',
    commandSubmitDelayMs: 200,
    namingCommand:
      'codex exec --ephemeral --sandbox read-only --model {model} --color never --json -',
    icon: 'openai.svg',
    alt: 'Codex',
    terminalOnly: true,
    supportsHooks: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    commands: ['claude'],
    versionArgs: ['--version'],
    cli: 'claude',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '',
    clipboardImagePaste: true,
    resumeFlag: '--resume',
    sessionIdFlag: '--session-id',
    appendSystemPromptFlag: '--append-system-prompt',
    commandPrefix: '/',
    planActivateCommand: '/plan',
    namingCommand: 'claude --print --model {model} --output-format text --no-session-persistence',
    icon: 'claude.png',
    alt: 'Claude Code',
    terminalOnly: true,
    supportsHooks: true,
  },
  {
    id: 'devin',
    name: 'Devin',
    description:
      "Cognition's Devin for Terminal agent for local, interactive coding sessions with Devin Cloud integration.",
    docUrl: 'https://cli.devin.ai/docs',
    installCommand: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
    commands: ['devin'],
    versionArgs: ['--version'],
    cli: 'devin',
    autoApproveFlag: '--permission-mode=bypass',
    initialPromptFlag: '--',
    resumeFlag: '--continue',
    planActivateCommand: '/plan',
    icon: 'devin.png',
    alt: 'Devin',
    terminalOnly: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description:
      "Cursor's agent CLI; provides editor-style, project-aware assistance from the shell.",
    docUrl: 'https://cursor.sh',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    commands: ['cursor-agent'],
    versionArgs: ['--version'],
    cli: 'cursor-agent',
    autoApproveFlag: '-f',
    initialPromptFlag: '',
    resumeFlag: '--resume',
    icon: 'cursor.svg',
    alt: 'Cursor CLI',
    terminalOnly: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description:
      'CLI that uses Google Gemini models to assist with coding, reasoning, and command-line tasks.',
    docUrl: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'npm install -g @google/gemini-cli',
    commands: ['gemini'],
    versionArgs: ['--version'],
    cli: 'gemini',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-i',
    resumeFlag: '--resume',
    icon: 'gemini.png',
    alt: 'Gemini CLI',
    terminalOnly: true,
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    description:
      "Command-line interface to Alibaba's Qwen Code models for coding assistance and code completion.",
    docUrl: 'https://github.com/QwenLM/qwen-code',
    installCommand: 'npm install -g @qwen-code/qwen-code',
    commands: ['qwen'],
    versionArgs: ['--version'],
    cli: 'qwen',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-i',
    resumeFlag: '--continue',
    icon: 'qwen.png',
    alt: 'Qwen Code CLI',
    terminalOnly: true,
  },
  {
    id: 'droid',
    name: 'Droid',
    description: "Factory AI's agent CLI for running multi-step coding tasks from the terminal.",
    docUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
    installCommand: 'curl -fsSL https://app.factory.ai/cli | sh',
    commands: ['droid'],
    versionArgs: ['--version'],
    cli: 'droid',
    initialPromptFlag: '',
    sessionIdFlag: '--session-id',
    sessionIdOnResumeOnly: true,
    icon: 'droid.svg',
    alt: 'Factory Droid',
    terminalOnly: true,
  },
  {
    id: 'amp',
    name: 'Amp',
    description:
      'Amp Code CLI for agentic coding sessions against your repository from the terminal.',
    docUrl: 'https://ampcode.com/manual#install',
    installCommand: 'npm install -g @sourcegraph/amp@latest',
    commands: ['amp'],
    versionArgs: ['--version'],
    cli: 'amp',
    autoApproveFlag: '--dangerously-allow-all',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    icon: 'ampcode.png',
    alt: 'Amp CLI',
    terminalOnly: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'OpenCode CLI that interfaces with models for code generation and edits from the shell.',
    docUrl: 'https://opencode.ai/docs/cli/',
    installCommand: 'npm install -g opencode-ai',
    commands: ['opencode'],
    versionArgs: ['--version'],
    cli: 'opencode',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    resumeFlag: '--continue',
    icon: 'opencode.png',
    alt: 'OpenCode CLI',
    invertInDark: true,
    terminalOnly: true,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    description:
      'Nous Research terminal agent with interactive chat, model-provider routing, skills, and session workflows.',
    docUrl: 'https://hermes-agent.nousresearch.com/docs/',
    installCommand:
      'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
    commands: ['hermes'],
    versionArgs: ['--version'],
    cli: 'hermes',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    resumeFlag: '--continue',
    icon: 'hermesagent.jpg',
    alt: 'Hermes Agent CLI',
    terminalOnly: true,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
    docUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    installCommand: 'npm install -g @github/copilot',
    commands: ['copilot'],
    versionArgs: ['--version'],
    cli: 'copilot',
    autoApproveFlag: '--allow-all-tools',
    resumeFlag: '--resume',
    icon: 'gh-copilot.svg',
    alt: 'GitHub Copilot CLI',
    terminalOnly: true,
  },
  {
    id: 'charm',
    name: 'Charm',
    description: 'Charm Crush agent CLI providing terminal-first AI assistance for coding tasks.',
    docUrl: 'https://github.com/charmbracelet/crush',
    installCommand: 'npm install -g @charmland/crush',
    commands: ['crush'],
    versionArgs: ['--version'],
    cli: 'crush',
    autoApproveFlag: '--yolo',
    icon: 'charm.png',
    alt: 'Charm CLI',
    invertInDark: true,
    terminalOnly: true,
  },
  {
    id: 'auggie',
    name: 'Auggie',
    description:
      'Augment Code CLI to run an agent against your repository for code changes and reviews.',
    docUrl: 'https://docs.augmentcode.com/cli/overview',
    installCommand: 'npm install -g @augmentcode/auggie',
    commands: ['auggie'],
    versionArgs: ['--version'],
    cli: 'auggie',
    initialPromptFlag: '',
    resumeFlag: '--continue',
    // otherwise user is prompted each time before prompt is passed
    defaultArgs: ['--allow-indexing'],
    icon: 'Auggie.svg',
    alt: 'Auggie CLI',
    terminalOnly: true,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Goose CLI that routes tasks to tools and models for coding workflows.',
    docUrl: 'https://block.github.io/goose/docs/quickstart/',
    installCommand:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    commands: ['goose'],
    versionArgs: ['--version'],
    cli: 'goose',
    // run subcommand with -s for interactive mode after initial prompt
    defaultArgs: ['run', '-s'],
    initialPromptFlag: '-t',
    resumeFlag: '--resume',
    icon: 'goose.png',
    alt: 'Goose CLI',
    terminalOnly: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    description:
      'Kimi CLI by Moonshot AI, with shell execution, Zsh integration, ACP, and MCP support.',
    docUrl: 'https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html',
    installCommand: 'uv tool install kimi-cli',
    commands: ['kimi'],
    versionArgs: ['--version'],
    cli: 'kimi',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-c',
    resumeFlag: '--continue',
    icon: 'kimi.png',
    alt: 'Kimi CLI',
    terminalOnly: true,
  },
  {
    id: 'kilocode',
    name: 'Kilocode',
    description:
      'Kilo AI coding assistant with multiple modes, broad model support, and checkpoint-based workflows.',
    docUrl: 'https://kilo.ai/docs/cli',
    installCommand: 'npm install -g @kilocode/cli',
    commands: ['kilocode'],
    versionArgs: ['--version'],
    cli: 'kilocode',
    autoApproveFlag: '--auto',
    initialPromptFlag: '',
    resumeFlag: '--continue',
    icon: 'kilocode.png',
    alt: 'Kilocode CLI',
    terminalOnly: true,
  },
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    description:
      'Kiro CLI by AWS, focused on interactive terminal-first development assistance and workflow automation.',
    docUrl: 'https://kiro.dev/docs/cli/',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
    commands: ['kiro-cli'],
    versionArgs: ['--version'],
    cli: 'kiro-cli',
    defaultArgs: ['chat'],
    initialPromptFlag: '',
    icon: 'kiro.png',
    alt: 'Kiro CLI',
    terminalOnly: true,
  },
  {
    id: 'rovo',
    name: 'Rovo Dev',
    description:
      'Atlassian Rovo Dev CLI integrates terminal assistance with Jira, Confluence, and Bitbucket workflows.',
    docUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    installCommand: 'acli rovodev auth login',
    commands: ['rovodev', 'acli'],
    versionArgs: ['--version'],
    autoApproveFlag: '--yolo',
    autoStartCommand: 'acli rovodev run',
    icon: 'atlassian.png',
    alt: 'Rovo Dev CLI',
    terminalOnly: true,
  },
  {
    id: 'cline',
    name: 'Cline',
    description:
      'Cline CLI runs coding agents directly in your terminal with multi-provider model support.',
    docUrl: 'https://docs.cline.bot/cline-cli/overview',
    installCommand: 'npm install -g cline',
    commands: ['cline'],
    versionArgs: ['help'],
    cli: 'cline',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '',
    icon: 'cline.png',
    alt: 'Cline CLI',
    terminalOnly: true,
  },
  {
    id: 'continue',
    name: 'Continue',
    description:
      'Continue CLI is a modular coding agent with configurable models, rules, and MCP tool support.',
    docUrl: 'https://docs.continue.dev/guides/cli',
    installCommand: 'npm i -g @continuedev/cli',
    commands: ['cn'],
    versionArgs: ['--version'],
    cli: 'cn',
    initialPromptFlag: '-p',
    resumeFlag: '--resume',
    icon: 'continue.png',
    alt: 'Continue CLI',
    terminalOnly: true,
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    description:
      'Codebuff is an AI coding agent for project-directory assistance and day-to-day development tasks.',
    docUrl: 'https://www.codebuff.com/docs/help/quick-start',
    installCommand: 'npm install -g codebuff',
    commands: ['codebuff'],
    versionArgs: ['--version'],
    cli: 'codebuff',
    initialPromptFlag: '',
    icon: 'codebuff.png',
    alt: 'Codebuff CLI',
    terminalOnly: true,
  },
  {
    id: 'mistral',
    name: 'Mistral Vibe',
    description:
      'Mistral AI terminal coding assistant with conversational codebase help, execution tools, and file operations.',
    docUrl: 'https://github.com/mistralai/mistral-vibe',
    installCommand: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
    commands: ['vibe'],
    versionArgs: ['-h'],
    cli: 'vibe',
    autoApproveFlag: '--auto-approve',
    initialPromptFlag: '',
    icon: 'mistral.png',
    alt: 'Mistral Vibe CLI',
    terminalOnly: true,
  },
  {
    id: 'jules',
    name: 'Jules',
    description:
      "Google's Jules CLI for managing asynchronous remote coding sessions and a terminal dashboard.",
    docUrl: 'https://jules.google/docs/cli/reference/',
    installCommand: 'npm install -g @google/jules',
    commands: ['jules'],
    versionArgs: ['version'],
    cli: 'jules',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    icon: 'jules.svg',
    alt: 'Jules CLI',
    terminalOnly: true,
  },
  {
    id: 'junie',
    name: 'Junie',
    description:
      'JetBrains agentic coding CLI for interactive terminal and headless project workflows.',
    docUrl: 'https://junie.jetbrains.com/docs/junie-cli.html',
    installCommand: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
    commands: ['junie'],
    versionArgs: ['--version'],
    cli: 'junie',
    initialPromptFlag: '--task',
    sessionIdFlag: '--session-id',
    icon: 'junie-color.png',
    alt: 'Junie CLI',
    terminalOnly: true,
  },
  {
    id: 'pi',
    name: 'Pi',
    description:
      'Minimal terminal coding agent with multi-provider model support and extensible custom tools.',
    docUrl: 'https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent',
    installCommand: 'npm install -g @mariozechner/pi-coding-agent',
    commands: ['pi'],
    versionArgs: ['--version'],
    cli: 'pi',
    initialPromptFlag: '',
    resumeFlag: '-c',
    icon: 'pi.png',
    alt: 'Pi CLI',
    terminalOnly: true,
  },
  {
    id: 'letta',
    name: 'Letta',
    description:
      'Memory-first coding agent CLI with persistent agents that learn across sessions and portable memory across models.',
    docUrl: 'https://docs.letta.com/letta-code/cli',
    installCommand: 'npm install -g @letta-ai/letta-code',
    commands: ['letta'],
    versionArgs: ['--version'],
    cli: 'letta',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '',
    // Bare `letta` auto-resumes the cwd's last conversation; `--new` is
    // required to start a fresh one when yoda spins up a new chat.
    newConversationFlag: '--new',
    useKeystrokeInjection: true,
    icon: 'letta.svg',
    alt: 'Letta Code CLI',
    invertInDark: true,
    terminalOnly: true,
  },
  {
    id: 'autohand',
    name: 'Autohand Code',
    description:
      'Terminal coding agent with auto-commit, dry-run previews, community skills, and headless automation modes.',
    docUrl: 'https://autohand.ai/code/',
    installCommand: 'npm install -g autohand-cli',
    commands: ['autohand'],
    versionArgs: ['--version'],
    cli: 'autohand',
    autoApproveFlag: '--unrestricted',
    initialPromptFlag: '-p',
    icon: 'autohand.svg',
    alt: 'Autohand Code CLI',
    terminalOnly: true,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    description:
      "Google's Gemini-powered terminal coding agent with multi-file edits, subagents, and tool calling.",
    docUrl: 'https://antigravity.google/docs/cli-getting-started',
    installCommand: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    commands: ['agy'],
    versionArgs: ['--version'],
    cli: 'agy',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '-i',
    resumeFlag: '--continue',
    icon: 'antigravity.png',
    alt: 'Antigravity CLI',
    terminalOnly: true,
  },
  {
    id: 'grok',
    name: 'Grok',
    description:
      "xAI's terminal coding agent (Grok Build) with plan mode, parallel subagents, and headless automation.",
    docUrl: 'https://x.ai/cli',
    installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    commands: ['grok'],
    versionArgs: ['--version'],
    cli: 'grok',
    autoApproveFlag: '--always-approve',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    commandPrefix: '/',
    icon: 'grok.svg',
    alt: 'Grok CLI',
    invertInDark: true,
    terminalOnly: true,
  },
];

const OPENAI_API_ENV = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_ENDPOINT',
] as const;

const GOOGLE_API_ENV = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
] as const;

const OPENROUTER_API_ENV = ['OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL'] as const;

const MULTI_MODEL_API_ENV = [
  ...OPENAI_API_ENV,
  'ANTHROPIC_API_KEY',
  ...GOOGLE_API_ENV,
  ...OPENROUTER_API_ENV,
] as const;

export const RUNTIME_ACCOUNT_PROFILES = {
  codex: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: OPENAI_API_ENV,
      probe: {
        defaultBaseUrl: 'https://api.openai.com/v1',
        path: '/models',
        baseUrlEnvVar: 'OPENAI_BASE_URL',
        authEnvVars: ['OPENAI_API_KEY'],
        auth: 'bearer',
      },
    },
    maas: { supported: true, providerHints: ['openai', 'azure'] },
  },
  claude: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
      probe: {
        defaultBaseUrl: 'https://api.anthropic.com',
        path: '/v1/models',
        baseUrlEnvVar: 'ANTHROPIC_BASE_URL',
        authEnvVars: ['ANTHROPIC_API_KEY'],
        auth: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
      },
    },
    maas: { supported: true, providerHints: ['anthropic', 'claude'] },
  },
  devin: {
    officialSubscription: { supported: true },
    officialApi: { envVars: [] },
    maas: { supported: true, providerHints: [] },
  },
  qwen: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: ['DASHSCOPE_API_KEY'],
      probe: {
        defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        path: '/models',
        authEnvVars: ['DASHSCOPE_API_KEY'],
        auth: 'bearer',
      },
    },
    maas: { supported: true, providerHints: ['qwen', 'dashscope', 'alibaba'] },
  },
  droid: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['FACTORY_API_KEY'] },
    maas: { supported: true, providerHints: [] },
  },
  gemini: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: GOOGLE_API_ENV,
      probe: {
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        path: '/models',
        baseUrlEnvVar: 'GOOGLE_GEMINI_BASE_URL',
        authEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        auth: 'x-goog-api-key',
      },
    },
    maas: { supported: true, providerHints: ['google', 'gemini'] },
  },
  cursor: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['CURSOR_API_KEY'] },
    maas: { supported: true, providerHints: [] },
  },
  copilot: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['COPILOT_CLI_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] },
    maas: { supported: true, providerHints: [] },
  },
  amp: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['AMP_API_KEY'] },
    maas: { supported: true, providerHints: [] },
  },
  opencode: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  hermes: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  charm: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  auggie: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['AUGMENT_SESSION_AUTH'] },
    maas: { supported: true, providerHints: [] },
  },
  goose: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  kimi: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
      probe: {
        defaultBaseUrl: 'https://api.moonshot.cn/v1',
        path: '/models',
        authEnvVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
        auth: 'bearer',
      },
    },
    maas: { supported: true, providerHints: ['moonshot', 'kimi'] },
  },
  kilocode: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  kiro: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: [
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
        'AWS_PROFILE',
        'AWS_REGION',
        'AWS_DEFAULT_REGION',
      ],
    },
    maas: { supported: true, providerHints: ['aws', 'amazon', 'bedrock'] },
  },
  rovo: {
    officialSubscription: { supported: true },
    officialApi: { envVars: [] },
    maas: { supported: true, providerHints: [] },
  },
  cline: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  continue: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  codebuff: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['CODEBUFF_API_KEY'] },
    maas: { supported: true, providerHints: [] },
  },
  mistral: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: ['MISTRAL_API_KEY'],
      probe: {
        defaultBaseUrl: 'https://api.mistral.ai/v1',
        path: '/models',
        authEnvVars: ['MISTRAL_API_KEY'],
        auth: 'bearer',
      },
    },
    maas: { supported: true, providerHints: ['mistral'] },
  },
  jules: {
    officialSubscription: { supported: true },
    officialApi: { envVars: GOOGLE_API_ENV },
    maas: { supported: true, providerHints: ['google', 'gemini'] },
  },
  junie: {
    officialSubscription: { supported: true },
    officialApi: { envVars: [] },
    maas: { supported: true, providerHints: [] },
  },
  pi: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  letta: {
    officialSubscription: { supported: true },
    officialApi: { envVars: MULTI_MODEL_API_ENV },
    maas: { supported: true, providerHints: [] },
  },
  autohand: {
    officialSubscription: { supported: true },
    officialApi: { envVars: ['AUTOHAND_API_KEY'] },
    maas: { supported: true, providerHints: [] },
  },
  antigravity: {
    officialSubscription: { supported: true },
    officialApi: { envVars: GOOGLE_API_ENV },
    maas: { supported: true, providerHints: ['google', 'gemini'] },
  },
  grok: {
    officialSubscription: { supported: true },
    officialApi: {
      envVars: ['XAI_API_KEY'],
      probe: {
        defaultBaseUrl: 'https://api.x.ai/v1',
        path: '/models',
        authEnvVars: ['XAI_API_KEY'],
        auth: 'bearer',
      },
    },
    maas: { supported: true, providerHints: ['xai', 'grok'] },
  },
} satisfies Record<RuntimeId, RuntimeAccountProfile>;

const PROVIDER_MAP = new Map<string, RuntimeDefinition>(
  RUNTIMES.map((provider) => [provider.id, provider])
);

export function getRuntime(id: RuntimeId): RuntimeDefinition | undefined {
  return PROVIDER_MAP.get(id);
}

export function getRuntimeAccountProfile(id: RuntimeId): RuntimeAccountProfile {
  return RUNTIME_ACCOUNT_PROFILES[id];
}

export function getInstallCommandForRuntime(id: RuntimeId): string | null {
  return PROVIDER_MAP.get(id)?.installCommand ?? null;
}

/**
 * Validates if a string is a valid provider ID.
 * @param value - The value to validate
 * @returns true if the value is a valid provider ID, false otherwise
 */
export function isValidRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === 'string' && RUNTIME_IDS.includes(value as RuntimeId);
}

export function getDescriptionForRuntime(id: RuntimeId): string | null {
  return PROVIDER_MAP.get(id)?.description ?? null;
}

export function getDocUrlForRuntime(id: RuntimeId): string | null {
  return PROVIDER_MAP.get(id)?.docUrl ?? null;
}

export function listDetectableRuntimes(): RuntimeDefinition[] {
  return RUNTIMES.filter((provider) => provider.detectable !== false && provider.commands?.length);
}
