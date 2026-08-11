import {
  classifyNavigation,
  evolveProbeStatus,
  nextDelayMinutes,
  normalizeTarget,
  PAGE_SETTLE_MS,
  PROBE_TIMEOUT_MS,
  shouldNotifyTransition,
} from './policy.js';

const CONFIG_KEY = 'sessionKeeperConfig';
const STATUS_KEY = 'sessionKeeperStatuses';
const ALARM_PREFIX = 'session-keeper:';
const NOTIFICATION_PREFIX = 'session-keeper-auth:';
const queuedTargetProbes = new Map();
let probeQueue = Promise.resolve();
let statusMutation = Promise.resolve();

function defaultConfig() {
  return { enabled: false, targets: [] };
}

async function readConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const value = stored[CONFIG_KEY];
  if (!value || !Array.isArray(value.targets)) return defaultConfig();

  const targets = [];
  for (const item of value.targets) {
    try {
      const target = normalizeTarget(item);
      if (target.id) targets.push(target);
    } catch {
      // Invalid user configuration remains visible in options, but is not scheduled.
    }
  }
  return { enabled: value.enabled === true, targets };
}

async function readStatuses() {
  const stored = await chrome.storage.local.get(STATUS_KEY);
  const value = stored[STATUS_KEY];
  return value && typeof value === 'object' ? value : {};
}

function updateStatus(targetId, updater) {
  const pending = statusMutation.then(async () => {
    const statuses = await readStatuses();
    const next = updater(statuses[targetId] ?? null);
    statuses[targetId] = next;
    await chrome.storage.local.set({ [STATUS_KEY]: statuses });
    return next;
  });
  statusMutation = pending.catch(() => undefined);
  return pending;
}

function alarmName(targetId) {
  return `${ALARM_PREFIX}${targetId}`;
}

function notificationId(targetId) {
  return `${NOTIFICATION_PREFIX}${targetId}`;
}

async function scheduleNext(target, immediate = false) {
  await chrome.alarms.create(alarmName(target.id), {
    delayInMinutes: immediate ? 0.5 : nextDelayMinutes(target.intervalMinutes),
    persistAcrossSessions: true,
  });
}

async function ensureSchedules({ recreate = false } = {}) {
  const config = await readConfig();
  const existing = await chrome.alarms.getAll();
  const existingByName = new Map(
    existing
      .filter((alarm) => alarm.name.startsWith(ALARM_PREFIX))
      .map((alarm) => [alarm.name, alarm])
  );
  const desired = new Map(
    config.enabled
      ? config.targets
          .filter((target) => target.enabled)
          .map((target) => [alarmName(target.id), target])
      : []
  );

  for (const name of existingByName.keys()) {
    if (recreate || !desired.has(name)) await chrome.alarms.clear(name);
  }
  for (const [name, target] of desired) {
    const existingAlarm = existingByName.get(name);
    const isValidOneShot =
      existingAlarm?.persistAcrossSessions === true &&
      !Number.isFinite(existingAlarm.periodInMinutes);
    if (recreate || !isValidOneShot) {
      if (existingAlarm) await chrome.alarms.clear(name);
      await scheduleNext(target);
    }
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function tabExists(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function closeTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The tab may already have been closed by the user or the page.
  }
}

async function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function finish(tab) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('页面在限定时间内没有完成加载。'));
    }, PROBE_TIMEOUT_MS);

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      finish(tab);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish(tab);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(error);
      });
  });
}

async function notifyAuthRequired(target) {
  await chrome.notifications.create(notificationId(target.id), {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.svg'),
    title: '需要重新登录',
    message: `${target.name} 已进入登录页。点击通知接管，完成后后台检查会自动恢复。`,
    priority: 1,
  });
}

async function focusHandoff(targetId) {
  const statuses = await readStatuses();
  const tabId = statuses[targetId]?.handoffTabId;
  if (!(await tabExists(tabId))) return false;
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return true;
}

async function performProbe(targetId, { allowWhenPaused = false } = {}) {
  const config = await readConfig();
  const target = config.targets.find((candidate) => candidate.id === targetId);
  if (!target || ((!config.enabled || !target.enabled) && !allowWhenPaused)) return null;

  let probeTabId = null;
  try {
    const statuses = await readStatuses();
    const previous = statuses[target.id] ?? null;
    const created = await chrome.tabs.create({ url: target.probeUrl, active: false });
    probeTabId = created.id ?? null;
    if (!Number.isInteger(probeTabId)) throw new Error('Chrome 没有返回后台标签编号。');

    await waitForTabComplete(probeTabId);
    await sleep(PAGE_SETTLE_MS);
    const finalTab = await chrome.tabs.get(probeTabId);
    const finalUrl = finalTab.url ?? finalTab.pendingUrl ?? '';
    const classification = classifyNavigation({
      probeUrl: target.probeUrl,
      finalUrl,
      loginUrlPatterns: target.loginUrlPatterns,
    });

    let handoffTabId = null;
    if (classification.state === 'auth_required') {
      if (await tabExists(previous?.handoffTabId)) {
        await closeTab(probeTabId);
        probeTabId = null;
        handoffTabId = previous.handoffTabId;
      } else {
        handoffTabId = probeTabId;
        probeTabId = null;
      }
    }

    const next = await updateStatus(target.id, (current) =>
      evolveProbeStatus(
        current,
        {
          ...classification,
          finalUrl,
          handoffTabId,
        },
        new Date().toISOString()
      )
    );

    if (shouldNotifyTransition(previous, next)) {
      await notifyAuthRequired(target).catch(() => undefined);
    }
    if (next.state === 'fresh') {
      await chrome.notifications.clear(notificationId(target.id)).catch(() => undefined);
    }
    return next;
  } catch (error) {
    const detail =
      error instanceof Error && error.message.includes('限定时间')
        ? '页面在限定时间内没有完成加载。'
        : 'Chrome 在检查页面时遇到错误。';
    return updateStatus(target.id, (current) =>
      evolveProbeStatus(current, {
        state: 'network_error',
        detail,
        finalUrl: '',
        handoffTabId: current?.handoffTabId ?? null,
      })
    );
  } finally {
    await closeTab(probeTabId);
  }
}

function runProbe(targetId, options = {}) {
  const existing = queuedTargetProbes.get(targetId);
  if (existing) return existing;

  const pending = probeQueue.then(() => performProbe(targetId, options));
  const tracked = pending.finally(() => queuedTargetProbes.delete(targetId));
  queuedTargetProbes.set(targetId, tracked);
  probeQueue = tracked.catch(() => undefined);
  return tracked;
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSchedules();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSchedules();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[CONFIG_KEY]) {
    void ensureSchedules({ recreate: true });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const targetId = alarm.name.slice(ALARM_PREFIX.length);
  void runProbe(targetId).finally(async () => {
    const config = await readConfig();
    const target = config.targets.find((candidate) => candidate.id === targetId);
    if (config.enabled && target?.enabled) await scheduleNext(target);
  });
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return;
  void focusHandoff(id.slice(NOTIFICATION_PREFIX.length));
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'run-now' && typeof message.targetId === 'string') {
    void runProbe(message.targetId, { allowWhenPaused: true })
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'focus-handoff' && typeof message.targetId === 'string') {
    void focusHandoff(message.targetId)
      .then((focused) => sendResponse({ ok: focused }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

void ensureSchedules();
