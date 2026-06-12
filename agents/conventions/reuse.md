# 复用与实体一致性（铁律）

两条原则，违反任何一条都算 bug，不是风格问题：

## 1. 同一实体，行为必须处处一致

同一个实体（任务、会话、文件、项目……）出现在不同 surface（侧边栏、顶部 tab、看板卡片、列表行），右键菜单、点击、拖拽等行为必须**完全一样**——共用同一份定义，而不是各写一份"看起来差不多"的。

- 任务菜单的唯一来源：`src/renderer/features/tasks/components/task-context-menu.tsx`（`TaskContextMenu` 右键 / `TaskActionsMenu` 三点 / `useMenuItems` 菜单项集中定义）。任何 surface 上的任务实体都必须用它。
- 会话菜单的唯一来源：`app-tab-context-menu.tsx` 的 `buildConversationSections()`。
- 新增 surface 时：先找实体的现有菜单/行为定义并复用；找不到就把现有实现提取成共享定义再用，**禁止就地另写一份**。
- 改菜单项时：只改集中定义，所有 surface 自动跟着变。如果发现某个 surface 是独立实现导致改不动，先合并再改。

## 2. 涉及文件展示，必须用共享文件组件

产品里任何展示文件/路径的地方（文件行、路径链接、文件菜单），用共享层，不要手拼 icon + 字符串 + 自制菜单：

- 路径操作与菜单：`src/renderer/lib/components/file-path-actions.tsx`（`FilePathTarget` / `FilePathMenuItems` / `useFilePathActions`）
- 任务上下文里的文件操作（编辑器打开、文件树定位等）：`src/renderer/features/tasks/components/file-actions.tsx`
- 文件图标：`src/renderer/lib/editor/file-icon.tsx`

如果共享层缺能力，给它加，然后所有调用点受益——不要在调用点旁边造一个特化版本。

## 自查

提交前问自己：这个组件/行为，仓库里是不是已经有了？同一实体在别处是什么行为？答不上来就先搜（`task-context-menu`、`file-path-actions`、实体名）再动手。
