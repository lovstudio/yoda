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

## PTY Frontend (`src/renderer/lib/pty/`)

Each live entity owns one `PtySession`, but its `FrontendPty`/xterm instance is
created lazily only after a real terminal surface explicitly requests it.
`PtySession.connect()` prepares xterm and settings; `usePty` subscribes output
only after mount, real-size measurement, and flush-gate activation. Observing
`status` is passive, so inactive terminals and status-only panels do not
allocate scrollback buffers or subscribe as flow-control consumers.

- `pty-session.ts` — single-flight connection state and deferred backend-ready gate
- `pty.ts` — persistent xterm instance, ordered output handshake, canonical DOM scene
- `use-pty.ts` — visible host, input, font, resize, links, and settings integration
- `pane-sizing-context.tsx` — active-session-only dimension reporting
- `pty-pane.tsx` — shared terminal component

**Lifecycle:** active surface requests preparation → backend-ready gate → create/configure
xterm → mount lease → measure + flush gate → subscribe listener-first → apply a
PTY-only snapshot/checkpoint watermark → unmount/off-screen with subscription retained →
checkpoint + unsubscribe on eviction → dispose

The warm frontend cache is always count-bounded. Hidden xterms inside the window keep
parsing into their canonical buffers while xterm pauses the off-screen DOM renderer. Auto
mode uses the default bound and may shrink it further after repeated app-memory pressure or
sustained hidden output; fixed mode changes the bound. Mounted, connecting, and
not-yet-recoverable renderers are protected, so they may temporarily exceed it. Eviction
waits for the atomic checkpoint/unsubscribe handoff and never terminates tmux or an Agent
session.

Explicit task opens use the real destination layout as a hidden staging host. Keep the
semantic opening surface opaque while `prepareConversationForOpen()` measures that
task-keyed pane, resizes the exact backend generation with `resizeForRenderer`, parses its
canonical PTY frame, and returns the xterm to its off-screen host. On the real mount, keep
the terminal hidden until `waitForVisibleFrame()` observes its refreshed rows and browser
paint; only then reveal and focus it. A cached hot reveal must first match
`getSessionState().generation`; a mismatch invalidates the frame and returns to staging.
Route state must not become a progress channel for mount, provision, resume, snapshot
parsing, or resize internals.

**Rules:**
- Output uses `{ generation, sequence }`; never revert to snapshot-first or
  listener-first without watermark deduplication.
- Subscription snapshots are committed PTY VT data or renderer-authored compact
  checkpoints only. Never feed transcript/session-history text into xterm.
- `term.write(..., callback)` acknowledgement drives main-process PTY
  pause/resume. Do not add a second renderer-side frame batch in front of
  xterm's own write queue.
- Only the active session receives live pane resizes. A background xterm and
  its backend PTY must never parse the same stream at different grids.
- During task-open staging, derive dimensions from the destination pane and bind
  resize plus canonical reveal to the same main-process generation. Never use a
  source task, sidebar pin, or 80x24 fallback as the destination's canonical grid.
- `mount()` returns a lease. React cleanup must pass that lease to `unmount()`
  and mount-scoped handlers so an older cleanup cannot detach a newer host.
- The core DOM renderer is the single visual scene. Resize from the live
  content box after layout, refresh from xterm's canonical buffer, and never
  add a retained-frame screenshot layer.
- `sessionId` format is
  `makePtySessionId(projectId, taskId, conversationId)` and is deterministic.

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
