import { buildDiagnostics, normalizeTarget } from './policy.js';

const CONFIG_KEY = 'sessionKeeperConfig';
const STATUS_KEY = 'sessionKeeperStatuses';

const elements = {
  masterEnabled: document.querySelector('#master-enabled'),
  form: document.querySelector('#target-form'),
  formError: document.querySelector('#form-error'),
  name: document.querySelector('#target-name'),
  interval: document.querySelector('#target-interval'),
  url: document.querySelector('#target-url'),
  patterns: document.querySelector('#target-patterns'),
  list: document.querySelector('#target-list'),
  empty: document.querySelector('#empty-state'),
  count: document.querySelector('#target-count'),
  toast: document.querySelector('#toast'),
};

let config = { enabled: false, targets: [] };
let statuses = {};
let composing = false;
let suppressSubmitUntil = 0;
let toastTimer = null;

const stateLabels = {
  fresh: '有效',
  auth_required: '需要登录',
  network_error: '网络异常',
  unknown: '待确认',
};

function formatTime(value) {
  if (!value) return '尚未检查';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { hour12: false });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2_400);
}

async function loadState() {
  const stored = await chrome.storage.local.get([CONFIG_KEY, STATUS_KEY]);
  const nextConfig = stored[CONFIG_KEY];
  config = nextConfig && Array.isArray(nextConfig.targets) ? nextConfig : config;
  statuses = stored[STATUS_KEY] && typeof stored[STATUS_KEY] === 'object' ? stored[STATUS_KEY] : {};
  render();
}

async function saveConfig() {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  render();
}

function statusClass(state) {
  return ['fresh', 'auth_required', 'network_error'].includes(state) ? state : 'unknown';
}

function createButton(label, action, targetId, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.targetId = targetId;
  button.className = className;
  return button;
}

function renderTarget(target) {
  const status = statuses[target.id] ?? null;
  const card = document.createElement('article');
  card.className = 'target-card';

  const top = document.createElement('div');
  top.className = 'target-top';
  const identity = document.createElement('div');
  identity.className = 'target-identity';
  const title = document.createElement('h3');
  title.textContent = target.name;
  const url = document.createElement('p');
  url.textContent = new URL(target.probeUrl).origin;
  identity.append(title, url);

  const controls = document.createElement('div');
  controls.className = 'target-controls';
  const badge = document.createElement('span');
  badge.className = `badge ${statusClass(status?.state)}`;
  badge.textContent = stateLabels[status?.state] ?? '未检查';
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'row-switch';
  toggleLabel.title = '启用目标';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = target.enabled;
  toggle.dataset.action = 'toggle';
  toggle.dataset.targetId = target.id;
  toggleLabel.append(toggle);

  const menu = document.createElement('details');
  menu.className = 'menu';
  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', `${target.name} 更多操作`);
  summary.textContent = '•••';
  const menuBody = document.createElement('div');
  menuBody.className = 'menu-body';
  menuBody.append(
    createButton('立即检查', 'run', target.id),
    createButton('打开页面', 'open', target.id),
    createButton('复制诊断', 'copy', target.id),
    createButton('删除', 'delete', target.id, 'danger')
  );
  menu.append(summary, menuBody);
  controls.append(badge, toggleLabel, menu);
  top.append(identity, controls);

  const facts = document.createElement('div');
  facts.className = 'target-facts';
  const checked = document.createElement('span');
  checked.textContent = `最近检查：${formatTime(status?.checkedAt)}`;
  const interval = document.createElement('span');
  interval.textContent = `间隔：${target.intervalMinutes} 分钟`;
  const streak = document.createElement('span');
  streak.textContent = `连续有效：${status?.consecutiveFresh ?? 0} 次`;
  facts.append(checked, interval, streak);

  const detail = document.createElement('p');
  detail.className = 'target-detail';
  detail.textContent = status?.detail ?? '启用后将访问一次只读页面确认状态。';

  card.append(top, facts, detail);
  if (status?.state === 'auth_required' && status?.handoffTabId) {
    const handoff = createButton('接管登录', 'handoff', target.id, 'handoff');
    card.append(handoff);
  }
  return card;
}

function render() {
  elements.masterEnabled.checked = config.enabled === true;
  elements.list.replaceChildren(...config.targets.map(renderTarget));
  elements.empty.hidden = config.targets.length > 0;
  elements.count.textContent = `${config.targets.length} 个`;
}

async function addTarget() {
  const target = normalizeTarget({
    id: crypto.randomUUID(),
    name: elements.name.value,
    probeUrl: elements.url.value,
    intervalMinutes: elements.interval.value,
    loginUrlPatterns: elements.patterns.value,
    enabled: false,
  });
  config = { ...config, targets: [...config.targets, target] };
  await saveConfig();
  elements.form.reset();
  elements.interval.value = '15';
  elements.formError.textContent = '';
  showToast('已添加并保持停用；请先运行一次检查。');
}

elements.form.addEventListener('compositionstart', () => {
  composing = true;
});
elements.form.addEventListener('compositionend', () => {
  composing = false;
  suppressSubmitUntil = Date.now() + 250;
});
elements.form.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) {
    suppressSubmitUntil = Date.now() + 250;
    event.stopPropagation();
  }
});
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (composing || Date.now() < suppressSubmitUntil) return;
  void addTarget().catch((error) => {
    elements.formError.textContent = error instanceof Error ? error.message : String(error);
  });
});

elements.masterEnabled.addEventListener('change', () => {
  config = { ...config, enabled: elements.masterEnabled.checked };
  void saveConfig().then(() => showToast(config.enabled ? '后台检查已开启。' : '后台检查已暂停。'));
});

elements.list.addEventListener('change', (event) => {
  const input = event.target.closest('input[data-action="toggle"]');
  if (!input) return;
  config = {
    ...config,
    targets: config.targets.map((target) =>
      target.id === input.dataset.targetId ? { ...target, enabled: input.checked } : target
    ),
  };
  void saveConfig();
});

elements.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const target = config.targets.find((candidate) => candidate.id === button.dataset.targetId);
  if (!target) return;

  const action = button.dataset.action;
  if (action === 'delete') {
    if (!window.confirm(`删除“${target.name}”？`)) return;
    config = {
      ...config,
      targets: config.targets.filter((candidate) => candidate.id !== target.id),
    };
    void saveConfig().then(() => showToast('已删除。'));
  } else if (action === 'open') {
    void chrome.tabs.create({ url: target.probeUrl, active: true });
  } else if (action === 'copy') {
    const diagnostics = JSON.stringify(buildDiagnostics(target, statuses[target.id]), null, 2);
    void navigator.clipboard
      .writeText(diagnostics)
      .then(() => showToast('诊断信息已复制。'))
      .catch((error) => showToast(`复制失败：${String(error)}`));
  } else if (action === 'handoff') {
    void chrome.runtime.sendMessage({ type: 'focus-handoff', targetId: target.id });
  } else if (action === 'run') {
    button.disabled = true;
    button.textContent = '检查中…';
    void chrome.runtime
      .sendMessage({ type: 'run-now', targetId: target.id })
      .then(async () => {
        await loadState();
        showToast('检查完成。');
      })
      .catch((error) => showToast(`检查失败：${String(error)}`))
      .finally(() => {
        button.disabled = false;
        button.textContent = '立即检查';
      });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[CONFIG_KEY] || changes[STATUS_KEY]) void loadState();
});

void loadState();
