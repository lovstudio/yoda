
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

## 铁律

- 合并前必须跑 `pnpm run format`、`pnpm run lint`、`pnpm run typecheck`、`pnpm test`。
- 同一实体在所有 surface 行为必须一致、文件展示必须走共享组件——见 `agents/conventions/reuse.md`，违反算 bug。
- 不要手改带编号的 Drizzle 迁移文件或 `drizzle/meta/`。
- 新 RPC 方法写进对应的 `src/main/core/*/controller.ts`，由 `src/main/rpc.ts` 自动注册。
- 只有需要 `event.sender` 的方法才在 `electron-api.d.ts` 里走手动 IPC。
- 新 modal 必须在 `src/renderer/core/modal/registry.ts` 注册。
- 新视图必须在 `src/renderer/core/view/registry.ts` 注册。
- `src/main/core/pty/`、`src/main/core/ssh/`、`src/main/db/` 和更新器代码视为高危。
- 除非任务明确涉及打包或更新器/签名，不要编辑 `dist/`、`release/`、`build/`。
- `docs/` 里的落地页与 Electron renderer 相互独立，默认端口同为 `3000`。对外文档内容不在本仓库——见 `agents/workflows/docs-site.md`。
