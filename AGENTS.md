
---
default_branch: main
package_manager: pnpm
node_version: "24.x.x"
start_command: "pnpm run d"
dev_command: "pnpm run dev"
build_command: "pnpm run build"
test_commands:
  - "pnpm run format"
  - "pnpm run lint"
  - "pnpm run typecheck"
  - "pnpm run test"
ports:
  dev: 3000
required_env: []
optional_env:
  - TELEMETRY_ENABLED
  - YODA_DB_FILE
  - YODA_DISABLE_NATIVE_DB
  - YODA_DISABLE_CLONE_CACHE
  - YODA_DISABLE_PTY
  - YODA_MOBILE_GATEWAY_DISABLED
  - YODA_MOBILE_GATEWAY_ENABLED
  - YODA_MOBILE_GATEWAY
  - YODA_MOBILE_GATEWAY_HOST
  - YODA_MOBILE_GATEWAY_PORT
  - YODA_MOBILE_GATEWAY_TOKEN
  - YODA_MOBILE_INSTALL_URL
  - YODA_MOBILE_EXPO_URL
  - YODA_MOBILE_METRO_DISABLED
  - YODA_MOBILE_REPO_PATH
  - YODA_REGISTER_DEEP_LINKS
  - CODEX_SANDBOX_MODE
  - CODEX_APPROVAL_POLICY
---

# Yoda Agent 指南

从这里开始。只按需加载与当前任务相关的 `agents/` 文档。

## 入门必读

- 仓库地图：`agents/README.md`
- 环境与命令：`agents/quickstart.md`
- 系统总览：`agents/architecture/overview.md`
- 校验流程：`agents/workflows/testing.md`

## 按任务查阅

- 主进程改动：`agents/architecture/main-process.md`
- Renderer/UI 改动：`agents/architecture/renderer.md`
- 移动端或 gateway 改动：`agents/architecture/mobile.md`
- 共享类型或 provider 元数据：`agents/architecture/shared.md`
- Worktree 行为或 `.yoda.json`：`agents/workflows/worktrees.md`
- SSH 或远程项目：`agents/workflows/remote-development.md`
- Provider 集成或 CLI 行为：`agents/integrations/providers.md`
- 文档站或落地页（yoda.lovstudio.ai）：`agents/workflows/docs-site.md`
- MCP 改动：`agents/integrations/mcp.md`
- ego-browser 会话健康检查：`agents/integrations/ego-browser-session-health.md`

## 高危区域

- 数据库与迁移：`agents/risky-areas/database.md`
- PTY/会话编排：`agents/risky-areas/pty.md`
- SSH 与 shell 转义：`agents/risky-areas/ssh.md`
- 自动更新与打包：`agents/risky-areas/updater.md`

## 约定

- IPC 契约与类型：`agents/conventions/ipc.md`
- 主进程模式（controllers、services、Result 类型、事件）：`agents/conventions/main-patterns.md`
- Renderer 模式（modals、views、PTY 前端、React Query contexts）：`agents/conventions/renderer-patterns.md`
- TypeScript 与 React 规范：`agents/conventions/typescript.md`
- 配置文件与仓库规则：`agents/conventions/config-files.md`
- 复用与实体一致性：`agents/conventions/reuse.md`
- 禁止 re-export，永远从原始源头 import
- 会被测试 import 的模块（logger、util、shared）里禁止 import `electron` 或 `@renderer/lib/ipc`，需要这些能力就导出 `setXxx(fn)` 由启动入口注入（2026-08-17, a38678e）
- 超时常数必须对照实测开销设定，并把实测数字写进注释（2026-08-17, a38678e）
- 改运行中 Yoda 自身的数据走 `node /tmp/yoda-renderer.mjs '<js>'` 调 `window.electronAPI.invoke`，不要直接写 DB，否则事件、版本快照、前端缓存三者不一致（2026-08-17, b1bfc34）

### 状态守卫约定（renderer stores）

`ProjectStore` 和 `TaskStore` 是会发生状态迁移的可变 MobX 类实例。按以下分层使用，不要混用：

**Selectors**（`task-selectors.ts`、`project-selectors.ts`）——纯函数，可安全用于 observer 组件、effects 和事件处理器：
- `getTaskStore(projectId, taskId)` → `TaskStore | undefined`
- `asProvisioned(store)` → `ProvisionedTask | undefined`（配合显式判空，禁止 `!`）
- `taskViewKind(store, projectId)` → `TaskViewKind`
- `getTaskManagerStore(projectId)` → `TaskManagerStore | undefined`（用它，不要穿透 project store 去拿）
- `getProjectStore(projectId)` → `ProjectStore | undefined`
- `asMounted(store)` → `MountedProject | undefined`（配合显式判空，禁止 `!`）

**Hooks**（`task-view-context.tsx`）——用于 task view 树内的 `observer` 组件：
- `useTaskViewKind()` —— 路由/状态门控
- `useProvisionedTask()` → `ProvisionedTask | null` —— 组件需要处理未 provisioned 状态时用
- `useRequireProvisionedTask()` → `ProvisionedTask` —— 组件只应在 provisioned 时渲染时用（违反不变量会抛出带描述的错误）

**规则：**
- 禁止 `asProvisioned(...)!` 或 `asMounted(...)!` ——用 hook 或显式判空
- 状态守卫必须写 `kind !== 'ready'`，禁止枚举非 ready 状态（新增状态会静默漏掉）
- 拿 task manager 用 `getTaskManagerStore(projectId)`，不要走 `project.taskManager`
- 拿已挂载项目用 `asMounted(getProjectStore(id))`，不要内联 `isMountedProject` 判断

### 任务状态同步约定（renderer sidebar）

- 侧栏任务状态异常先沿 `persistence → main event → renderer store → selector → observer row` 完整链路排查；虚拟列表行的 wrapper、memo 或测量 ref 不是状态源。
- `appState.agentRuntime` 是实时 Agent 会话状态的权威镜像；已挂载的 conversation store 负责标题、runtime、交互时间等展示元数据，并在 runtime hydration 期间提供回退。
- `taskStatusUpdatedChannel` 驱动持久化任务生命周期，`agentSessionStatusChangedChannel` 驱动 Agent 运行态；两条链路语义独立，不能用其中一条替代另一条。

## 铁律

- 合并前必须跑 `pnpm run format`、`pnpm run lint`、`pnpm run typecheck`、`pnpm test`。
- 手机客户端在独立仓库 `lovstudio/yoda-mobile`，本仓库只有 gateway 与 relay。gateway/relay 的改动若会影响手机上的可见行为，必须装到已连接的真实 iPhone 上验证本次目标流程；模拟器、静态检查或截图都不能代替真机验收。
- 同一实体在所有 surface 行为必须一致、文件展示必须走共享组件——见 `agents/conventions/reuse.md`，违反算 bug。
- 不要手改带编号的 Drizzle 迁移文件或 `drizzle/meta/`。
- 新 RPC 方法写进对应的 `src/main/core/*/controller.ts`，由 `src/main/rpc.ts` 自动注册。
- 只有需要 `event.sender` 的方法才在 `electron-api.d.ts` 里走手动 IPC。
- 新 modal 必须在 `src/renderer/core/modal/registry.ts` 注册。
- 新视图必须在 `src/renderer/core/view/registry.ts` 注册。
- `src/main/core/pty/`、`src/main/core/ssh/`、`src/main/db/` 和更新器代码视为高危。
- 除非任务明确涉及打包或更新器/签名，不要编辑 `dist/`、`release/`、`build/`。
- `docs/` 里的落地页与 Electron renderer 相互独立，默认端口同为 `3000`。对外文档内容不在本仓库——见 `agents/workflows/docs-site.md`。
- renderer 里改后端 PTY 尺寸只能走 `src/renderer/lib/pty/pty-resize-authority.ts`，禁止直接调 `rpc.pty.resize` / `resizeForRenderer`：一个 PTY 只有一份 grid，观察者窗口（独立看板）改了会连带改窄主窗口的 TUI（2026-08-18, c429a81）。
- 列表既有筛选又有数量上限时，必须先筛后截断，跨窗口推送的候选列表保持不截断（2026-08-18, c429a81）。
- 任务列表 surface 的筛选/排序只能走 `@shared/task-view-options` + `TaskViewOptionsMenu`，禁止在单个 surface 里另写一份（2026-08-18, 7d40aff）。

## 注意
- 我正在以开发模式运行与迭代 yoda，不要打开我已安装的 yoda
- Electron IPC 会丢弃 Error 的自定义属性、只保留 message：主进程要把 status/code 传到 renderer 必须编进 message，否则 renderer 里 `'status' in error` 是死代码（2026-08-17, 3cade15）
- 会话分享的体量上限分散在 web 仓库四层（zod blocks.max / 路由字节检查 / 表 CHECK 约束 / Vercel 线路字节），只放开一层会换一种错误码而非修好（2026-08-17, 3cade15）
- 分享载荷加字段必须同步改 web 仓库 `sessionShareBaseSchema`：它是 `.strict()`，多一个未声明字段整个上传报 400 invalid_session_share（2026-08-18, 99c4f5e）
- 访问 `http://localhost:3000` 仅能看到 Yoda 静态 splash 而没有 Electron preload/RPC 时，停止用 ego-browser 继续操作该 renderer，改用当前开发实例的原生 IPC/可回读存储验证（2026-08-18, b40ff86）。
- 排序键 locale collation 陷阱：未排序哨兵必须是字母（如 'z'），不能是标点（ICU 将标点排在数字前，会使未排序项浮到顶部）（2026-08-18, 359a1b9）
- dnd-kit 测试每个指针步骤必须独立 act()：拖拽开始后 droppable rects 在 effect 里测量，批量手势会在 over 变为非 null 前结束（2026-08-18, 359a1b9）
- Base UI 弹层退场动画：卸载前必须先关闭弹层（Esc + 250ms 等待），否则全局 bookkeeping 认为菜单还开着，下次 trigger 拒绝打开（2026-08-18, 359a1b9）
- Base UI Tabs 只挂载激活面板：测试里断言非激活 tab 的内容必须先点 tab 再 waitFor（2026-08-18, 8c3195a）
- 去掉组件的 `observer` 包裹会让 react-hooks/set-state-in-effect 等规则突然开始生效，原有 effect 里的同步 setState 会新报 lint（2026-08-18, 8c3195a）
- base-ui 弹层不能互相嵌套：DropdownMenu(Menu.Root) 嵌进 ContextMenu 会让内层菜单 parent.type 判成 context-menu、trigger 点不开；同一元素上要叠加左键下拉就改用 Popover（PopoverRoot 是独立树，且 Popover 默认 click 开、Menu 默认 mousedown 开；非 button 元素 trigger 要加 `nativeButton={false}`）（2026-08-19, 6e70b60f）
