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
