/**
 * Installed Claude Code plugin model.
 *
 * Plugins are the container form of Agent Skills distribution: a single plugin
 * can bundle skills, slash commands, subagents, hooks and MCP servers. Yoda
 * already scans plugin-bundled skills for context (see scanClaudeSkills.ts);
 * these types back a first-class plugin manager that lists installed plugins,
 * surfaces their bundled components, and supports enable/disable + uninstall.
 *
 * Discovery sources (all under ~/.claude/plugins):
 *   - installed_plugins.json  -> which plugins are installed + installPath
 *   - <installPath>/.claude-plugin/plugin.json -> name/description/author/version
 *   - <installPath>/{commands,skills,agents,hooks,.mcp.json} -> bundled components
 * Enable state lives in ~/.claude/settings.json under `enabledPlugins`.
 */

/** Count of each component kind a plugin bundles. */
export interface PluginComponentCounts {
  commands: number;
  skills: number;
  agents: number;
  hooks: number;
  mcpServers: number;
}

/** One skill bundled inside a plugin, for inspection in the detail view. */
export interface PluginBundledSkill {
  /** Skill directory name */
  name: string;
  /** Frontmatter description (may be empty) */
  description: string;
}

export interface InstalledPlugin {
  /** Unique id = the "name@marketplace" key from installed_plugins.json */
  id: string;
  /** Plugin name (segment before `@`) */
  name: string;
  /** Marketplace id (segment after `@`); undefined for local installs */
  marketplace?: string;
  /** From plugin.json */
  description?: string;
  author?: string;
  version?: string;
  /** Absolute install directory */
  installPath: string;
  /** ISO 8601 install timestamp from the manifest */
  installedAt?: string;
  /** Enabled per ~/.claude/settings.json `enabledPlugins` (default true). */
  enabled: boolean;
  /** Component counts for at-a-glance cards */
  components: PluginComponentCounts;
  /** Bundled skills with name + description */
  skills: PluginBundledSkill[];
  /** Bundled slash command names (e.g. "lovstudio:release") */
  commands: string[];
}

export interface PluginIndex {
  version: number;
  lastUpdated: string;
  plugins: InstalledPlugin[];
}
