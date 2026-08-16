/**
 * The bar's copy. The plugin follows the DSH i18n system: dictionaries register
 * into the shared locale registry under this namespace, and the active locale
 * is the Host-backed preference — so switching the app language switches the
 * bar live rather than at the next reload.
 */

/** Locale namespace this plugin registers its dictionaries under. */
export const LOCALE_NS = 'yodaRuntimeBar';

/** The Chinese dictionary, and the shape every other locale must satisfy. */
export const zh = {
  directory: '目录',
  directoryOpen: '在系统中打开',
  stateRunning: '运行中',
  stateWaiting: '等待输入',
  stateDone: '已完成',
  stateIdle: '空闲',
  jobs: '后台任务',
  jobsDetail: '{running} 个运行中',
  sessions: '会话',
  sessionsDetail: '{running} 个运行中，共 {total} 个',
  subagent: '子智能体',
} as const;

/** Dictionary keys, derived from the Chinese source so a locale cannot drift. */
export type BarLocaleKey = keyof typeof zh;

/** The English dictionary. */
export const en: Record<BarLocaleKey, string> = {
  directory: 'Directory',
  directoryOpen: 'Open in the system file manager',
  stateRunning: 'Running',
  stateWaiting: 'Waiting for you',
  stateDone: 'Done',
  stateIdle: 'Idle',
  jobs: 'Background jobs',
  jobsDetail: '{running} running',
  sessions: 'Sessions',
  sessionsDetail: '{running} running of {total}',
  subagent: 'Subagent',
};

/** Translate one key, substituting `{name}` placeholders. */
export type BarTranslate = (key: BarLocaleKey, params?: Record<string, string | number>) => string;

/**
 * Build the translator for an active locale.
 *
 * The dictionaries are read straight from this module rather than through the
 * locale service: the service owns the *language choice* (and the registry the
 * settings UI reads), while the copy itself is the plugin's own — going through
 * the registry to read back what we just wrote adds a failure mode and no
 * capability.
 * @param active - the locale service's active language tag.
 */
export function createTranslate(active: string): BarTranslate {
  const dict = active.startsWith('zh') ? zh : en;
  return (key, params) => {
    const template = dict[key];
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match
    );
  };
}
