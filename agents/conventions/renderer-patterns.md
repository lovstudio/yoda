# Renderer Patterns

## Modal System (`src/renderer/core/modal/`)

All modals use a registry-based system. Only one modal can be active at a time.

- `registry.ts` — central registry mapping modal IDs to components
- `modal-provider.tsx` — React context managing active modal state
- `modal-renderer.tsx` — renders the currently active modal

**Adding a modal:**
1. Create the component accepting `BaseModalProps<TResult>` (provides `onSuccess` and `onClose` callbacks)
2. Register it in `registry.ts`
3. Open it via the hook:

```tsx
const { showModal } = useModalContext();
showModal('myModal', { projectId: '123', onSuccess: (result) => {...} });
```

**Rules:**
- All modals must be registered in `registry.ts`
- `showModal` is type-safe — TypeScript infers required args from the registry
- `hasActiveCloseGuard` prevents dismissal during critical operations

## View System (`src/renderer/core/view/`)

Views use a registry + parameterized navigation pattern.

- `registry.ts` — view definitions with optional `WrapView`, `TitlebarSlot`, `MainPanel`, `RightPanel`
- `provider.tsx` — state management, navigation, param persistence
- `layout-provider.tsx` — panel collapse/expand/drag state

**Key behaviors:**
- `navigate(viewId, params?)` is type-safe; params are optional when all fields are optional
- Params persist per-view (navigating away and back preserves params)
- Modal automatically closes on navigation
- `updateViewParams(viewId, partial)` updates params without re-navigating

**Rules:**
- Views are singletons — one per ViewId
- MainPanel is required; RightPanel and WrapView are optional
- Add new views to `registry.ts`

## PTY Frontend (`src/renderer/core/pty/`)

Terminal sessions use a registry + pool pattern.

- `pty.ts` — `FrontendPty` class with `FrontendPtyRegistry` (module-level singleton, survives React unmounts)
- `pty-pool.ts` — `TerminalPool` managing up to 16 reusable xterm.js instances
- `use-pty.ts` — React hook integrating FrontendPty + TerminalPool
- `pty-session-context.tsx` — context for session registration
- `pty-pane.tsx` — terminal component (forwardRef)

**Lifecycle:** register → attach → detach → unregister

**Rules:**
- `registerSession()` must happen BEFORE RPC starts the PTY to avoid missing output
- `FrontendPty` buffers output (max 1 MB) when no xterm is attached, drains on `attach()`
- Terminal instances are never disposed — they're parked off-screen and reused from the pool
- `sessionId` format: `makePtySessionId(projectId, taskId, conversationId)` — deterministic
- Panel drag pauses resizing to avoid jank (`panelDragStore`)

## React Query Context Pattern

Context providers use React Query for data fetching with optimistic updates:

```tsx
// Pattern used in AppSettingsProvider, ProjectProvider, etc.
const { data } = useQuery({ queryKey: ['resource'], queryFn: () => rpc.ns.get() });
const mutation = useMutation({
  mutationFn: (args) => rpc.ns.update(args),
  onMutate: async (args) => {
    // optimistic update via queryClient.setQueryData
  },
  onError: () => {
    // rollback via queryClient.setQueryData with previous snapshot
  },
});
```

**Rules:**
- Contexts combine React Query + local state, not standalone useState
- Use `useAppSettingsKey(key)` for fine-grained per-setting hooks
- Optimistic updates must include rollback on error

## State Outside React

For state that must survive React unmounts or be shared across unrelated components:

- **`useSyncExternalStore`-compatible stores** — e.g., `panelDragStore` in `src/renderer/lib/`
- **Module-level singletons** — e.g., `FrontendPtyRegistry`, `TerminalPool`
- **Manager classes** — e.g., `PendingInjectionManager`, `TaskTerminalsStore`

## 宽度自适应（容器查询）

App 内几乎所有 surface 都不是整窗宽：侧边栏、可 pin 的 side pane、settings 内嵌 tab 都会把同一个视图挤进任意宽度的容器。视口断点（`sm:`/`lg:`）在桌面端基本恒为 true，按窗口宽算的布局在窄 pane 里必然出错。

**规则：**
- pane 内渲染的视图，根节点标 `@container`，断点一律用容器变体（`@2xl:grid-cols-2`），不用视口断点。参考 `settings-view.tsx`、`UsageView`、`SkillsView`
- 一个组件会被多种宿主复用（composer 弹层、settings modal）时，在组件自己的根上标 `@container`，让断点跟随组件实际宽度。参考 `ModeConfigurationPanel`
- 视口断点只允许出现在真正跟视口走的元素上：modal/dialog 尺寸（`agent-edit-modal` 的 `sm:grid-cols-2` 是合法的）
- 工具条/chip 行禁止 `min-w-max` + `overflow-x-auto`：macOS overlay 滚动条不可见，超宽内容会被静默裁切，用户不知道右边还有控件。用 `flex-wrap` 换行（参考 home composer 工具条）
- 横向溢出验收：把窗口/pane 压到 ~440px，所有控件必须可见或换行，不允许裁切

## 产品控件语法（先于视觉润色）

新增或调整一组控件前，先按用户意图分类，禁止因为“放得下”或“看起来更明显”临时混用 button、icon、badge：

| 意图 | 默认控件 | 必须满足 |
| --- | --- | --- |
| 状态信息 | `Badge` / 文本 | 不伪装成可点击动作；图标语义与状态一致 |
| 工具栏中的同级动作 | 同规格 icon button | 整组尺寸、variant 语法一致；每项都有 Tooltip 与 `aria-label` |
| 低频或语义不直观的设置动作 | 带文字 Button | 文案直接描述用户目标，图标只能辅助，不得代替含义 |
| 页面主动作 | 带文字的 primary Button | 每个 surface 通常只有一个最高视觉权重 |
| 开关/固定/选中 | Toggle 或 `aria-pressed` | 必须显示当前状态，不能只在点击后 toast 提示 |
| 危险动作 | destructive Button，或工具栏内延迟显色的 icon button | 必须有确认机制；不能与普通动作长期同权重抢色 |

**同组一致性：**

- 同一工具栏只能有一种主要动作语法。禁止出现“两个文字按钮夹着两个纯图标”的混排；确需突出主动作时，必须用分组、分隔或位置层级明确区分。
- 响应式切换必须以整组为单位，禁止单个按钮因为宽度变化独自从文字变图标，导致同级动作语法漂移。
- 标题栏的紧凑同级动作优先复用 `src/renderer/lib/components/header-actions.tsx`；不要重复手写 Tooltip、尺寸和无障碍名称。
- 常规、按下、加载、禁用、危险、键盘聚焦六种状态都属于交付范围，不是后续 polish。
- i18n 文案与图标都按“用户要完成什么”命名，不按内部实现命名；图标含义不够明确时必须保留文字。

**提交前验收：**

1. 圈出同一行的所有可点击控件，逐项说明它属于状态、导航、普通动作、切换还是危险动作。
2. 检查同级动作的高度、圆角、variant、Tooltip、焦点态是否一致。
3. 在正常宽度与约 440px 容器宽度下检查，不允许出现单项降级造成的 button/icon 混排。
4. 用键盘遍历一遍，确认每个 icon button 都能从 Tooltip 或无障碍名称知道用途。
5. 对照同一实体在其他 surface 的行为；如果已有共享组件，必须复用。
